# Elbiler – smart opladning (design)

Dato: 2026-09-25. Godkendt af Martin i chat.

## Mål
Flere elbiler kan tilføjes i panelets Elbiler-fane. Hver bil lades i de billigste tidsrum inden en
deadline, styret via to entiteter (start og stop), som brugeren selv vælger – fra laderen eller bilen.

## Datamodel (HA Store `electricity_optimizer.cars`, version 1)
```
car = {
  id, name,
  soc_entity,            # sensor i %
  start_entity,          # switch | button | script | input_boolean
  stop_entity,           # samme domæner; må være samme entitet som start
  plugged_entity,        # binary_sensor, valgfri
  capacity_kwh, charge_power_kw,
  enabled (bool), target_soc (int), ready_by ("HH:MM"),
  price_limit (float|null), charge_now (bool)
}
```

## Start/stop-semantik
- Start: aktiver start-entiteten (switch/input_boolean → turn_on, button → press, script → turn_on).
- Stop: hvis stop-entitet == start-entitet og domænet er switch/input_boolean → turn_off; ellers aktiveres
  stop-entiteten på samme måde som start.

## Planlægning (hvert minut + efter enhver ændring)
1. Slots fra EnergiDataService (raw_today + raw_tomorrow). Slots frem til deadline uden kendt pris får
   dagens gennemsnit som estimat, så planen kan laves før kl. 13.
2. Pr. bil: skip hvis SoC ukendt. `desired=False` hvis ikke tilsluttet, slået fra eller SoC ≥ mål.
   `desired=True` hvis "Lad nu" eller pris ≤ prisgrænse. Ellers: behov = (mål−SoC)/100·kapacitet/effekt
   timer; vælg billigste slots inden deadline til behovet er dækket; `desired` = nuværende slot valgt.
3. Kommando sendes kun når `desired` afviger fra sidst sendte kommando (første gang sendes altid).
4. Runtime-status pr. bil (status, plan, behov, næste start, sidste handling) eksponeres via websocket.

## Websocket
- `electricity_optimizer/cars/list` → biler + runtime.
- `electricity_optimizer/cars/save` (delvis eller hel bil; uden id = ny).
- `electricity_optimizer/cars/delete` (id).

## Frontend
Elbiler-fanen: kort pr. bil (SoC mod mål, status, næste ladning, plan-strimmel, indstillinger inline,
Lad nu, Rediger, Slet) og formular til tilføj/rediger med entitetsvælgere filtreret på domæne.
