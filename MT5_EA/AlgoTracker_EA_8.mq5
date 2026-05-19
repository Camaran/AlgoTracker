//+------------------------------------------------------------------+
//|                                              AlgoTracker_EA.mq5  |
//|                          Expert Advisor para AlgoTracker Journal  |
//|                                                                    |
//| DESCRIPCIÓN:                                                       |
//|   Este EA monitorea los trades cerrados y los envía automáticamente|
//|   al backend FastAPI via HTTP POST en formato JSON.                |
//|   v2.0 — Soporte multicuenta via X-API-Key header                 |
//|                                                                    |
//| COMPATIBILIDAD: MetaTrader 5 (MQL5)                               |
//| AUTOR: AlgoTracker Project                                         |
//+------------------------------------------------------------------+

// ==================================================================
// SECCIÓN 1: PROPIEDADES DEL EA
// ==================================================================
#property copyright   "AlgoTracker Project"
#property link        "http://localhost:8000"
#property version     "2.00"
#property description "Envía trades cerrados a AlgoTracker FastAPI backend (multicuenta)"

// ==================================================================
// SECCIÓN 2: PARÁMETROS DE ENTRADA (configurables desde MT5)
// ==================================================================
input string   InpApiUrl         = "http://127.0.0.1:8000/trade"; // URL del endpoint FastAPI
input string   InpApiKey         = "";          // API Key de esta cuenta (generada en AlgoTracker)
input int      InpMagicNumber    = 0;           // Magic Number (0 = todos los trades)
input int      InpRetryAttempts  = 3;           // Intentos de reenvío si falla la conexión
input int      InpRetryDelayMs   = 2000;        // Espera entre reintentos (ms)
input bool     InpSaveToFile     = true;        // Guardar en archivo si backend no responde
input string   InpFallbackFile   = "algotracker_pending.txt"; // Archivo de respaldo
input bool     InpVerboseLogging = true;        // Mostrar logs detallados en Experts tab

// ==================================================================
// SECCIÓN 3: VARIABLES GLOBALES
// ==================================================================
ulong g_lastProcessedTicket = 0;
ulong g_sentTickets[];

// ==================================================================
// SECCIÓN 4: OnInit()
// ==================================================================
int OnInit()
{
   Print("=================================================");
   Print("AlgoTracker EA v2.0 iniciado (Multicuenta)");
   Print("URL Backend: ", InpApiUrl);
   Print("API Key configurada: ", StringLen(InpApiKey) > 0 ? "SI (" + IntegerToString(StringLen(InpApiKey)) + " chars)" : "NO — REQUERIDA");
   Print("Magic Number filtro: ", InpMagicNumber == 0 ? "TODOS" : IntegerToString(InpMagicNumber));
   Print("Reintentos: ", InpRetryAttempts);
   Print("Guardar en archivo si falla: ", InpSaveToFile ? "SI" : "NO");
   Print("=================================================");

   if(StringLen(InpApiKey) == 0)
   {
      Print("CRÍTICO: InpApiKey está vacío. El EA no podrá enviar trades al backend.");
      Print("Genera una API Key en AlgoTracker > Agregar Cuenta y pégala en el parámetro InpApiKey.");
      // No retornamos INIT_FAILED para permitir monitoreo sin envío
   }

   LoadSentTickets();
   ScanAndSendHistoricalTrades();

   return(INIT_SUCCEEDED);
}

// ==================================================================
// SECCIÓN 5: OnDeinit()
// ==================================================================
void OnDeinit(const int reason)
{
   Print("AlgoTracker EA detenido. Razón código: ", reason);
   SaveSentTickets();
}

// ==================================================================
// SECCIÓN 6: OnTick() — backup por si OnTradeTransaction falla
// ==================================================================
void OnTick()
{
   CheckForClosedTrades();
}

// ==================================================================
// SECCIÓN 7: OnTradeTransaction() — detección principal de cierres
// ==================================================================
void OnTradeTransaction(
   const MqlTradeTransaction& trans,
   const MqlTradeRequest&     request,
   const MqlTradeResult&      result
)
{
   if(trans.type != TRADE_TRANSACTION_DEAL_ADD)
      return;

   ulong dealTicket = trans.deal;
   if(dealTicket <= 0)
      return;

   if(InpVerboseLogging)
      Print("Nuevo deal detectado - ticket: ", dealTicket, " deal_type: ", trans.deal_type);

   datetime timeFrom = TimeCurrent() - 86400;
   HistorySelect(timeFrom, TimeCurrent());

   if(!HistoryDealSelect(dealTicket))
   {
      HistorySelect(D'2020.01.01 00:00:00', TimeCurrent());
      if(!HistoryDealSelect(dealTicket))
      {
         if(InpVerboseLogging)
            Print("OnTradeTransaction: no se pudo seleccionar deal ", dealTicket);
         return;
      }
   }

   long dealEntry = HistoryDealGetInteger(dealTicket, DEAL_ENTRY);
   if(dealEntry == DEAL_ENTRY_OUT || dealEntry == DEAL_ENTRY_INOUT)
   {
      Sleep(200);
      ProcessDealByTicket(dealTicket);
   }
}

// ==================================================================
// SECCIÓN 8: CheckForClosedTrades() — backup en OnTick
// ==================================================================
void CheckForClosedTrades()
{
   datetime timeFrom = TimeCurrent() - 86400;
   datetime timeTo   = TimeCurrent();

   if(!HistorySelect(timeFrom, timeTo))
   {
      if(InpVerboseLogging)
         Print("Error al cargar historial de deals");
      return;
   }

   int totalDeals = HistoryDealsTotal();

   for(int i = totalDeals - 1; i >= 0; i--)
   {
      ulong dealTicket = HistoryDealGetTicket(i);
      if(dealTicket <= 0)
         continue;

      if(IsTicketAlreadySent(dealTicket))
         continue;

      long dealEntry = HistoryDealGetInteger(dealTicket, DEAL_ENTRY);
      if(dealEntry != DEAL_ENTRY_OUT && dealEntry != DEAL_ENTRY_INOUT)
         continue;

      ProcessDealByTicket(dealTicket);
   }
}

// ==================================================================
// SECCIÓN 9: ProcessDealByTicket()
// ==================================================================
void ProcessDealByTicket(ulong dealTicket)
{
   if(IsTicketAlreadySent(dealTicket))
   {
      if(InpVerboseLogging)
         Print("Deal ", dealTicket, " ya fue enviado, omitiendo...");
      return;
   }

   if(!HistoryDealSelect(dealTicket))
   {
      HistorySelect(D'2020.01.01 00:00:00', TimeCurrent());
      if(!HistoryDealSelect(dealTicket))
      {
         Print("ERROR: No se pudo seleccionar deal ", dealTicket);
         return;
      }
   }

   long   dealType       = HistoryDealGetInteger(dealTicket, DEAL_TYPE);
   long   dealMagic      = HistoryDealGetInteger(dealTicket, DEAL_MAGIC);
   long   dealCloseTime  = HistoryDealGetInteger(dealTicket, DEAL_TIME);
   long   dealPositionId = HistoryDealGetInteger(dealTicket, DEAL_POSITION_ID);

   double dealVolume     = HistoryDealGetDouble(dealTicket, DEAL_VOLUME);
   double dealPrice      = HistoryDealGetDouble(dealTicket, DEAL_PRICE);
   double dealSL         = HistoryDealGetDouble(dealTicket, DEAL_SL);
   double dealTP         = HistoryDealGetDouble(dealTicket, DEAL_TP);
   double dealProfit     = HistoryDealGetDouble(dealTicket, DEAL_PROFIT);
   double dealCommission = HistoryDealGetDouble(dealTicket, DEAL_COMMISSION);
   double dealSwap       = HistoryDealGetDouble(dealTicket, DEAL_SWAP);

   string dealSymbol  = HistoryDealGetString(dealTicket, DEAL_SYMBOL);
   string dealComment = HistoryDealGetString(dealTicket, DEAL_COMMENT);

   if(InpMagicNumber != 0 && dealMagic != InpMagicNumber)
   {
      if(InpVerboseLogging)
         Print("Deal ", dealTicket, " magic=", dealMagic, " no coincide con filtro ", InpMagicNumber, ". Omitido.");
      return;
   }

   if(StringLen(dealSymbol) == 0)
   {
      if(InpVerboseLogging)
         Print("Deal ", dealTicket, " sin símbolo. Omitido.");
      return;
   }

   double   openPrice   = 0;
   datetime openTime    = 0;
   string   orderType   = "";
   string   openComment = "";

   GetPositionOpenData(dealPositionId, openPrice, openTime, orderType, openComment, dealSymbol);

   if(openPrice == 0)
   {
      Print("ADVERTENCIA: No se encontró deal de apertura para posición ", dealPositionId);
      orderType = (dealType == DEAL_TYPE_BUY) ? "SELL" : "BUY";
   }

   datetime closeTimeDateTime = (datetime)dealCloseTime;
   string   openTimeStr       = FormatTimestamp(openTime);
   string   closeTimeStr      = FormatTimestamp(closeTimeDateTime);

   if(StringLen(orderType) == 0)
      orderType = DealTypeToString(dealType);

   if(InpVerboseLogging)
   {
      Print("=== Procesando deal cerrado ===");
      Print("  Ticket:      ", dealTicket);
      Print("  Símbolo:     ", dealSymbol);
      Print("  Tipo:        ", orderType);
      Print("  Volumen:     ", dealVolume);
      Print("  Precio Open: ", openPrice);
      Print("  Precio Close:", dealPrice);
      Print("  Profit:      ", dealProfit);
      Print("  Magic:       ", dealMagic);
      Print("  Open Time:   ", openTimeStr);
      Print("  Close Time:  ", closeTimeStr);
   }

   string jsonPayload = BuildJsonPayload(
      dealTicket, dealMagic, openComment, dealSymbol,
      orderType, dealVolume, openPrice, dealPrice,
      dealSL, dealTP, openTimeStr, closeTimeStr,
      dealProfit, dealCommission, dealSwap
   );

   if(InpVerboseLogging)
      Print("JSON a enviar: ", jsonPayload);

   bool success = SendToBackend(jsonPayload, dealTicket);

   if(success)
   {
      AddToSentTickets(dealTicket);
      Print("✓ Deal ", dealTicket, " enviado exitosamente a AlgoTracker");
   }
   else
   {
      Print("✗ Error al enviar deal ", dealTicket, ". Ver logs anteriores.");
      if(InpSaveToFile)
         SaveTradeToFile(jsonPayload, dealTicket);
   }
}

// ==================================================================
// SECCIÓN 10: GetPositionOpenData()
// ==================================================================
void GetPositionOpenData(
   long      positionId,
   double&   openPrice,
   datetime& openTime,
   string&   orderType,
   string&   openComment,
   string    symbol
)
{
   datetime timeFrom = TimeCurrent() - (86400 * 730);
   datetime timeTo   = TimeCurrent();

   if(!HistorySelect(timeFrom, timeTo))
      return;

   int totalDeals = HistoryDealsTotal();

   for(int i = 0; i < totalDeals; i++)
   {
      ulong ticket = HistoryDealGetTicket(i);
      if(ticket <= 0)
         continue;

      long pid = HistoryDealGetInteger(ticket, DEAL_POSITION_ID);
      if(pid != positionId)
         continue;

      long entry = HistoryDealGetInteger(ticket, DEAL_ENTRY);
      if(entry != DEAL_ENTRY_IN)
         continue;

      openPrice = HistoryDealGetDouble(ticket, DEAL_PRICE);
      openTime  = (datetime)HistoryDealGetInteger(ticket, DEAL_TIME);

      long dType = HistoryDealGetInteger(ticket, DEAL_TYPE);
      orderType  = (dType == DEAL_TYPE_BUY) ? "BUY" : "SELL";

      if(InpVerboseLogging)
         openComment = HistoryDealGetString(ticket, DEAL_COMMENT);
         Print("  Deal apertura encontrado: ticket=", ticket, " price=", openPrice, " time=", openTime);

      return;
   }

   if(InpVerboseLogging)
      Print("  ADVERTENCIA: No se encontró deal de apertura para posición ", positionId, " símbolo ", symbol);
}

// ==================================================================
// SECCIÓN 11: BuildJsonPayload()
// ==================================================================
string BuildJsonPayload(
   ulong  ticket,
   long   magicNumber,
   string comment,
   string symbol,
   string orderType,
   double volume,
   double openPrice,
   double closePrice,
   double stopLoss,
   double takeProfit,
   string openTime,
   string closeTime,
   double profit,
   double commission,
   double swap
)
{
   string safeComment = EscapeJsonString(comment);
   string safeSymbol  = EscapeJsonString(symbol);

   string json = "{";
   json += "\"ticket\":"       + IntegerToString(ticket)        + ",";
   json += "\"magic_number\":" + IntegerToString(magicNumber)   + ",";
   json += "\"comment\":\""    + safeComment                    + "\",";
   json += "\"symbol\":\""     + safeSymbol                     + "\",";
   json += "\"order_type\":\"" + orderType                      + "\",";
   json += "\"volume\":"       + DoubleToString(volume, 2)      + ",";
   json += "\"open_price\":"   + DoubleToString(openPrice, 8)   + ",";
   json += "\"close_price\":"  + DoubleToString(closePrice, 8)  + ",";
   json += "\"stop_loss\":"    + DoubleToString(stopLoss, 8)    + ",";
   json += "\"take_profit\":"  + DoubleToString(takeProfit, 8)  + ",";
   json += "\"open_time\":\""  + openTime                       + "\",";
   json += "\"close_time\":\"" + closeTime                      + "\",";
   json += "\"profit\":"       + DoubleToString(profit, 2)      + ",";
   json += "\"commission\":"   + DoubleToString(commission, 2)  + ",";
   json += "\"swap\":"         + DoubleToString(swap, 2);
   json += "}";

   return json;
}

// ==================================================================
// SECCIÓN 12: SendToBackend() — con X-API-Key header
// ==================================================================
bool SendToBackend(string jsonPayload, ulong dealTicket)
{
   // Validar que tenemos API Key antes de intentar enviar
   if(StringLen(InpApiKey) == 0)
   {
      Print("ERROR: InpApiKey vacío. Configura la API Key de la cuenta en los parámetros del EA.");
      return false;
   }

   uchar  postData[];
   uchar  resultData[];
   string resultHeaders = "";

   StringToCharArray(jsonPayload, postData, 0, StringLen(jsonPayload));

   // ─── CAMBIO CLAVE v2.0: X-API-Key en el header ───────────────
   string requestHeaders = "Content-Type: application/json\r\n";
   requestHeaders += "X-API-Key: " + InpApiKey + "\r\n";
   // ─────────────────────────────────────────────────────────────

   for(int attempt = 1; attempt <= InpRetryAttempts; attempt++)
   {
      if(InpVerboseLogging && attempt > 1)
         Print("Reintento ", attempt, "/", InpRetryAttempts, " para deal ", dealTicket);

      ArrayResize(resultData, 0);
      resultHeaders = "";

      int httpCode = WebRequest(
         "POST",
         InpApiUrl,
         requestHeaders,
         5000,
         postData,
         resultData,
         resultHeaders
      );

      string responseBody = CharArrayToString(resultData, 0, ArraySize(resultData));

      if(InpVerboseLogging)
         Print("HTTP ", httpCode, " - Respuesta: ", responseBody);

      if(httpCode == 200 || httpCode == 201)
         return true;

      // Trade ya existe en backend
      if(httpCode == 409)
      {
         Print("Deal ", dealTicket, " ya existe en backend (409). Marcando como enviado.");
         return true;
      }

      // API Key inválida
      if(httpCode == 401)
      {
         Print("ERROR 401 — API Key inválida o cuenta inactiva.");
         Print("Verifica InpApiKey en los parámetros del EA.");
         return false;   // No tiene sentido reintentar con la misma key
      }

      // Error de validación del JSON
      if(httpCode == 422)
      {
         Print("ERROR 422 - Error de validación. JSON: ", jsonPayload);
         Print("Respuesta servidor: ", responseBody);
         return false;
      }

      if(httpCode == -1)
      {
         int lastError = GetLastError();
         Print("Error de red (código ", lastError, ") - Intento ", attempt, "/", InpRetryAttempts);
         if(lastError == 4014)
         {
            Print("CRÍTICO: WebRequest no permitido. Agregar URL en MT5 > Herramientas > Opciones > Expert Advisors");
            return false;
         }
         if(attempt < InpRetryAttempts)
            Sleep(InpRetryDelayMs);
      }
      else
      {
         Print("HTTP ", httpCode, " inesperado para deal ", dealTicket, " - Respuesta: ", responseBody);
         if(attempt < InpRetryAttempts)
            Sleep(InpRetryDelayMs);
      }
   }

   Print("FALLARON todos los ", InpRetryAttempts, " intentos para deal ", dealTicket);
   return false;
}

// ==================================================================
// SECCIÓN 13: SaveTradeToFile() — respaldo local
// ==================================================================
void SaveTradeToFile(string jsonPayload, ulong dealTicket)
{
   int fileHandle = FileOpen(
      InpFallbackFile,
      FILE_WRITE | FILE_TXT | FILE_SHARE_READ | FILE_ANSI
   );

   if(fileHandle == INVALID_HANDLE)
   {
      Print("ERROR: No se pudo abrir archivo de respaldo: ", InpFallbackFile);
      Print("Error código: ", GetLastError());
      return;
   }

   FileSeek(fileHandle, 0, SEEK_END);

   string line = FormatTimestamp(TimeCurrent()) + "|" + IntegerToString(dealTicket) + "|" + jsonPayload + "\n";
   FileWriteString(fileHandle, line);

   FileClose(fileHandle);

   Print("Trade ", dealTicket, " guardado en archivo de respaldo: ", InpFallbackFile);
   Print("ACCIÓN REQUERIDA: Reenviar manualmente cuando backend esté disponible");
}

// ==================================================================
// SECCIÓN 14: ScanAndSendHistoricalTrades()
// ==================================================================
void ScanAndSendHistoricalTrades()
{
   Print("Escaneando trades históricos pendientes...");

   datetime timeFrom = TimeCurrent() - (86400 * 2);
   datetime timeTo   = TimeCurrent();

   if(!HistorySelect(timeFrom, timeTo))
   {
      Print("No se pudo cargar historial para escaneo inicial");
      return;
   }

   int totalDeals  = HistoryDealsTotal();
   int pendingCount = 0;

   for(int i = 0; i < totalDeals; i++)
   {
      ulong ticket = HistoryDealGetTicket(i);
      if(ticket <= 0)
         continue;

      long entry = HistoryDealGetInteger(ticket, DEAL_ENTRY);
      if(entry != DEAL_ENTRY_OUT && entry != DEAL_ENTRY_INOUT)
         continue;

      if(IsTicketAlreadySent(ticket))
         continue;

      long magic = HistoryDealGetInteger(ticket, DEAL_MAGIC);
      if(InpMagicNumber != 0 && magic != InpMagicNumber)
         continue;

      pendingCount++;
      Print("Trade pendiente encontrado: ", ticket, " - Enviando...");
      ProcessDealByTicket(ticket);
      Sleep(500);
   }

   if(pendingCount == 0)
      Print("No hay trades pendientes de envío.");
   else
      Print("Escaneo inicial completado. Procesados: ", pendingCount, " trades.");
}

// ==================================================================
// SECCIÓN 15: Gestión de tickets enviados (anti-duplicados)
// ==================================================================
bool IsTicketAlreadySent(ulong ticket)
{
   int size = ArraySize(g_sentTickets);
   for(int i = 0; i < size; i++)
      if(g_sentTickets[i] == ticket)
         return true;
   return false;
}

void AddToSentTickets(ulong ticket)
{
   int newSize = ArraySize(g_sentTickets) + 1;
   ArrayResize(g_sentTickets, newSize);
   g_sentTickets[newSize - 1] = ticket;
}

void SaveSentTickets()
{
   int fileHandle = FileOpen(
      "algotracker_sent_tickets.txt",
      FILE_WRITE | FILE_TXT | FILE_ANSI
   );

   if(fileHandle == INVALID_HANDLE)
   {
      Print("No se pudo guardar registro de tickets enviados");
      return;
   }

   int size = ArraySize(g_sentTickets);
   for(int i = 0; i < size; i++)
      FileWriteString(fileHandle, IntegerToString(g_sentTickets[i]) + "\n");

   FileClose(fileHandle);

   if(InpVerboseLogging)
      Print("Guardados ", size, " tickets en registro");
}

void LoadSentTickets()
{
   if(!FileIsExist("algotracker_sent_tickets.txt"))
   {
      Print("No hay registro previo de tickets enviados. Comenzando desde cero.");
      return;
   }

   int fileHandle = FileOpen(
      "algotracker_sent_tickets.txt",
      FILE_READ | FILE_TXT | FILE_ANSI | FILE_SHARE_READ
   );

   if(fileHandle == INVALID_HANDLE)
   {
      Print("No se pudo abrir registro de tickets enviados");
      return;
   }

   int count = 0;
   while(!FileIsEnding(fileHandle))
   {
      string line = FileReadString(fileHandle);
      StringTrimRight(line);
      StringTrimLeft(line);

      if(StringLen(line) > 0)
      {
         ulong ticket = (ulong)StringToInteger(line);
         if(ticket > 0)
         {
            AddToSentTickets(ticket);
            count++;
         }
      }
   }

   FileClose(fileHandle);
   Print("Cargados ", count, " tickets del registro anterior");
}

// ==================================================================
// SECCIÓN 16: Funciones auxiliares
// ==================================================================
string FormatTimestamp(datetime dt)
{
   if(dt == 0)
      return "1970-01-01T00:00:00";

   MqlDateTime mdt;
   TimeToStruct(dt, mdt);

   return StringFormat("%04d-%02d-%02dT%02d:%02d:%02d",
      mdt.year, mdt.mon, mdt.day,
      mdt.hour, mdt.min, mdt.sec
   );
}

string DealTypeToString(long dealType)
{
   switch((int)dealType)
   {
      case DEAL_TYPE_BUY:          return "BUY";
      case DEAL_TYPE_SELL:         return "SELL";
      case DEAL_TYPE_BALANCE:      return "BALANCE";
      case DEAL_TYPE_CREDIT:       return "CREDIT";
      case DEAL_TYPE_CHARGE:       return "CHARGE";
      case DEAL_TYPE_CORRECTION:   return "CORRECTION";
      case DEAL_TYPE_BONUS:        return "BONUS";
      case DEAL_TYPE_COMMISSION:   return "COMMISSION";
      case 8:                      return "COMMISSION_DAILY";
      case 9:                      return "COMMISSION_MONTHLY";
      case 10:                     return "AGENT_DAILY";
      case 11:                     return "AGENT_MONTHLY";
      case DEAL_TYPE_INTEREST:     return "INTEREST";
      case DEAL_TYPE_BUY_CANCELED: return "BUY_CANCELED";
      case DEAL_TYPE_SELL_CANCELED:return "SELL_CANCELED";
      default:                     return "UNKNOWN_" + IntegerToString(dealType);
   }
}

string EscapeJsonString(string rawStr)
{
   string output = rawStr;
   StringReplace(output, "\\", "\\\\");
   StringReplace(output, "\"", "\\\"");
   StringReplace(output, "\n", "\\n");
   StringReplace(output, "\r", "\\r");
   StringReplace(output, "\t", "\\t");
   return output;
}

//+------------------------------------------------------------------+
//| FIN DEL ARCHIVO                                                    |
//+------------------------------------------------------------------+
