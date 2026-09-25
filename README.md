# Electricity Optimizer

Home Assistant-integration (installeres via HACS), der udnytter strøm fra solceller og de billigste
timer på elmarkedet til hus og elbil, og bruger husbatteriet når prisen er højest.

Integrationen tilføjer et menupunkt **Electricity Optimizer** i Home Assistants sidebar med tre faner:

- **Forsiden** – pris lige nu, laveste/højeste/gennemsnit i dag, prisgraf for i dag og i morgen,
  billigste og dyreste timer fremover samt status for solceller, batteri og elbiler.
- **Solceller** – produktion lige nu (og udnyttelse af kWp), produceret i dag mod prognosen,
  prognose for i dag/i morgen, solens højde og op-/nedgang samt dagens produktionskurve
  (hentet fra Home Assistants historik).
- **Elbiler** – indstillinger for opladning af elbiler (kommer).
- **Hus batteri** – indstillinger for opladning/afladning af husbatteri (kommer).

## Krav

- Home Assistant 2024.7 eller nyere.
- [EnergiDataService](https://github.com/MTrab/energidataservice) installeret og sat op.
  Integrationen læser priserne fra dens sensor (som standard `sensor.energi_data_service`).

## Installation via HACS

1. HACS → Integrations → menu (⋮) → *Custom repositories*.
2. Tilføj `https://github.com/MartinJensenDK/ElectricityOptimizer` med kategori *Integration*.
3. Installer **Electricity Optimizer** og genstart Home Assistant.
4. Indstillinger → Enheder og tjenester → *Tilføj integration* → **Electricity Optimizer**.
5. Vælg EnergiDataService-prissensoren og (valgfrit) dine solcelle-sensorer. Menupunktet dukker op i sidebaren.

Sensorerne kan altid ændres under Indstillinger → Enheder og tjenester → Electricity Optimizer → **Konfigurer**.

### Solcelle-sensorer

| Felt | Forventet | Eksempel |
| --- | --- | --- |
| Produktion lige nu | sensor i W eller kW (device_class `power`) | inverterens PV-effekt |
| Produktion i dag | sensor i kWh (device_class `energy`), nulstilles dagligt | inverterens "yield today" |
| Produktion i alt | sensor i kWh, akkumuleret | inverterens "total yield" |
| Prognose i dag / i morgen | sensor i kWh | Solcast eller Forecast.Solar |
| Installeret effekt | tal i kWp | 6,4 |

## Manuel installation

Kopiér mappen `custom_components/electricity_optimizer` til `config/custom_components/` i din
Home Assistant-installation og genstart.

## Struktur

```
custom_components/electricity_optimizer/
├── __init__.py            # registrerer statisk sti og sidebar-panel
├── config_flow.py         # opsætning + Konfigurer: prissensor og solcelle-sensorer
├── const.py
├── manifest.json
├── strings.json
├── translations/          # da, en
└── frontend/
    └── electricity-optimizer-panel.js   # panelet (web component, ingen build-step)
```
