# smarthome-core

Libreria Node.js indipendente per le primitive condivise di Smart Home. Non avvia server, non apre porte, non esegue discovery e non contiene integrazioni hardware.

## Schema canonico v1

Il registry canonico è:

```json
{
  "version": 1,
  "devices": []
}
```

Ogni dispositivo fisico contiene `id`, `alias`, `manufacturer` opzionale, `model`, `protocol`, `connectionType` (`lan` o `cloud`), `identity`, `connection`, `capabilities`, `metadata` e gli stati di configurazione/verifica. Ruoli e stato runtime non fanno parte dell'identità fisica.

Le assegnazioni usano una mappa separata `{ "physical-device-id": "logical.role" }`; `none` indica assenza di ruolo. I nomi ruolo sono aperti e namespace-friendly, ad esempio `pond.pump`, `home.room_sensor` o `home.camera`.

La versione è **1** perché è il primo schema del Core, non una copia della numerazione interna di un'app. Pond-Control v4 dovrà essere trasformato da collezioni `plugs`/`sensors`/`cameras` a `devices`, spostando i ruoli legacy nel role store. Home-Control v4 dovrà trasformare il suo array `devices` nella versione 1, rinominando la configurazione tecnica generica nei campi `identity` e `connection`. Nessuna trasformazione viene eseguita in questa fase.

I dati di identità/configurazione devono restare privi di credenziali; le credenziali rimangono sempre nella configurazione locale dell'app che usa il Core.

## Primitive esportate

- `normalizeDevice`
- `normalizeHardwareRegistry` e `validateHardwareRegistry`
- `normalizeRoleAssignments`
- costanti e classi errore associate

## Piano di migrazione

1. **Step A:** Core indipendente (questo step).
2. **Step B:** spostare una prima integrazione già funzionante di Pond-Control nel Core.
3. **Step C:** fare usare a Pond-Control l'integrazione dal Core.
4. **Step D:** fare usare la stessa integrazione a Home-Control.

Lo step B è implementato per Tapo C410; le app restano responsabili di registry, ruoli, credenziali, HTTP e UI.

## Tapo C410

Il Core espone il manager tecnico C410, il probe read-only e il lifecycle generico dei runtime. L'app chiamante inietta IP, credenziali, interprete Python e directory di output: il Core non legge `.env`, non assegna ruoli e non espone HTTP.

## Adapter Dewin / Tuya read-only

Il Core include ora un client Tuya Cloud esclusivamente GET e un adapter Dewin che riceve tutte le configurazioni dal chiamante. Non legge variabili d'ambiente e non avvia richieste all'import.

`DewinTuyaAdapter.read()` restituisce un oggetto con `deviceId`, stato `online`, `datapoints` completi e `measurements`. Le misure realmente gestite dall'implementazione Dewin di origine sono `ambientTemperature`, `ambientHumidity`, `externalProbeTemperature`, `batteryState`, `temperatureCalibration`, `humidityCalibration` e `temperatureCorrection`. Ogni misura è un datapoint normalizzato con `raw`, `scale`, `unit` e `value`, oppure `null` se assente.

Polling, cache/stale, persistenza storico, log e qualsiasi interpretazione relativa a un impianto specifico restano responsabilità dell'app chiamante.
