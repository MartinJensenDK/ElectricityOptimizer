# Electricity Optimizer

Home Assistant-integration (installeres via HACS), der udnytter strøm fra solceller og de billigste
timer på elmarkedet til hus og elbil, og bruger husbatteriet når prisen er højest.

Integrationen tilføjer et menupunkt **Electricity Optimizer** i Home Assistants sidebar med tre faner:

- **Forsiden** – live-række med gauges for solproduktion, husforbrug, elnet, batteri-effekt og batteri-%,
  prisgraf for i dag og i morgen med lodret nu-streg (prisen lige nu står i toppen), ladeperioder for
  biler og husbatteri (lyseblå felt fra start til forventet slut) og elbilernes planlagte ladetimer, billigste og dyreste timer fremover, status for solceller,
  batteri og elbiler samt reglerne for opladning.
- **Solceller** – produktion lige nu (og udnyttelse af kWp), produceret i dag mod prognosen,
  prognose for i dag/i morgen, solens højde og op-/nedgang samt dagens produktionskurve
  (hentet fra Home Assistants historik).
- **Elbiler** – tilføj vilkårligt mange biler; hver bil lades automatisk i de billigste tidsrum inden
  en deadline, styret via de start/stop-entiteter du vælger (lader eller bil).
- **Hus batteri** – live SoC, batteri-, net- og husforbrugs-effekt, modus lige nu (Normal / Hold /
  Lad fra nettet), planstrimmel, manuel styring og indstillinger.
- **Historik** – ladeperioder for elbiler og husbatteri: hvornår, fra sol eller net, kWh, betalt, gennemsnitspris
  og sparet (sol = hvad energien ville have kostet fra nettet; net = i forhold til dagens gennemsnitspris),
  med sum for i dag, 7 dage og 30 dage, samt en log over alle kommandoer, integrationen har sendt. Der gemmes 90 dage.

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

## Elbiler

Under fanen **Elbiler** tilføjer du en bil med:

| Felt | Beskrivelse |
| --- | --- |
| SoC-sensor | Bilens batteriniveau i % |
| Start opladning | `switch`, `button`, `script`, `input_boolean` eller `automation`. Tændes/trykkes når der skal lades |
| Stop opladning | Samme domæner. Er det **samme switch** som start, slukkes den – ellers tændes/trykkes stop-entiteten. Har laderen kun én switch, vælges den begge steder |
| Tilsluttet-sensor | Valgfri `binary_sensor`; er den `off`, startes der ikke |
| Kapacitet | kWh, bruges sammen med ladestrømmen til at beregne hvor mange timer der skal lades |
| Min./maks. ladestrøm / faser | A og 1–3 faser; planen regner med maks. × 230 V × faser. Ved solopladning justeres strømmen mellem min. og maks. Begge kan ændres direkte på bilens kort |
| Strømgrænse-entitet | Valgfri `number`/`input_number`. Ved netopladning sættes den før start; ved solopladning sendes kun start-kommandoen, og strømmen sendes første gang efter det valgte interval og justeres derefter løbende |
| Ladeeffekt-sensor | Valgfri sensor (W/kW) med bilens faktiske ladeeffekt; vises live og bruges i sol-regnestykket |
| Kilde | *Kun sol*, *Sol + billige timer* (standard) eller *Kun billige timer* – vælges pr. ugedag i ugeplanen (formularens valg gælder alle dage ved oprettelse) |

Pr. bil kan du løbende ændre **Smart opladning** til/fra, **prisgrænse** (lad altid under denne pris),
**min./maks. ladestrøm** (A), **kilde** og trykke **Lad nu**.

**Ugeplan**: på bilens kort (altid synlig) sættes for hver ugedag om bilen skal være klar, kilde,
klokkeslæt og mål-SoC (rækken "Alle dage" sætter alle syv). På dage med *Kun sol* vælges der ingen
billige timer, heller ikke frem mod en deadline på en senere dag. Deadline findes som næste aktive dag, så en slukket lørdag
betyder, at der planlægges frem mod søndag eller mandag med de billigste timer undervejs.
Er alle dage slået fra, lades kun fra sol, prisgrænse eller "Lad nu".

Planen genberegnes hvert minut: de billigste tidsrum (EnergiDataService, 15 eller 60 min) inden
deadline vælges, indtil behovet er dækket. Timer uden kendt pris (før kl. 13) estimeres til dagens
gennemsnit. Der sendes kun start/stop, når den ønskede tilstand skifter.

**Solopladning** (kilde *Kun sol* eller *Sol + billige timer*): overskuddet er eksporten til nettet
(plus det, husbatteriet lader med, når elbilen har solprioritet). Opladning starter, når overskuddet
har dækket min. ladestrøm i *start efter*-minutter, strømmen følger overskuddet mellem min. og maks.,
og stopper når overskuddet har været for lille i *stop efter*-minutter. Bilens eget forbrug regnes
med, så den ikke slukker sig selv. Flere biler får sol i den rækkefølge, de står i (▲/▼ på kortet).

## Regler for opladning

Kortet **Regler for opladning** nederst på Forsiden styrer samspillet mellem elbil og husbatteri. Alle kort, målere og felter i panelet har et (i)-ikon med forklaring, og felter uden betydning skjules:

| Regel | Betydning |
| --- | --- |
| Sol prioritet | Sorterbar liste (træk eller tryk ⇅): nr. 1 får solstrømmen først. *Elbil* som nr. 1: bilen får eksport + batteriets ladeeffekt. *Husbatteri* som nr. 1: elbilen lader ikke fra sol |
| Prioriter over / under (%) | Interval for nr. 1's ladestand. Er ladestanden over den øvre eller under den nedre grænse, prioriteres der ikke længere, og solstrømmen bruges normalt (bilen får kun den rene eksport) |
| Elbil-sol: sol ≥ (W) | Elbilen lader kun fra sol, når solcellerne (effekt-sensoren fra opsætningen) har produceret mindst så meget i det valgte antal minutter; falder produktionen under grænsen lige så længe, stopper bilen. Tom = kun overskuddet afgør det |
| Ladestrøm hvert (sek) | Ved solopladning sendes ladestrømmen første gang så mange sekunder efter start og justeres derefter højst så ofte |
| … i mindst (min) | Hvor længe produktion og overskud skal være over grænsen, før der startes, og under, før der stoppes |
| Sol-overskud beregnes fra | *Elnet-sensor*: overskud = det, der sælges til nettet. *Solproduktion − husforbrug*: overskud = solcelle-effekt (Konfigurer) − husforbrug − det, husbatteriet lader med, så ladestrømmen følger produktionen direkte. Med "Husforbruget inkluderer elbilens ladning" lægges bilens eget træk til, mens den lader |
| Hovedsikring (A) | Valgfri øvre grænse pr. fase for elbiler + batteri-opladning fra nettet. Tom = ingen grænse |
| Ved sikring først til | Vises kun når hovedsikringen er sat: *Elbil* holder batteriet tilbage, *Husbatteri* begrænser eller udsætter bilen |
| Hold husbatteri ved net-ladning | Standard til: batteriet tømmes ikke ned i bilen om natten |
| Net-/husforbrugs-sensor | Import/eksport-sensor og husforbrugs-sensor til sol-overskud, hvis husbatteriet ikke har dem |

## Hus batteri

Under fanen **Hus batteri** vælger du sensorer (SoC, batteri-effekt med fortegn eller separate
lade/aflade-sensorer, net import/eksport, husforbrug), batteriets kapacitet og maks. effekter, og
valgfrit to styringer med hver en start- og stop-kommando:

| Styring | Betydning |
| --- | --- |
| Lad fra nettet | Tving opladning fra elnettet (fx switch "force charge" eller select "Charge") |
| Hold batteriet | Ingen afladning – batteriet spares (fx switch "stop discharge" eller select "Hold") |

En kommando er en entitet plus evt. en værdi: `switch`/`input_boolean` tændes (slukkes hvis samme
entitet bruges til stop), `button` trykkes, `script`/`automation` køres, `select` får valgt værdien,
`number` sættes til værdien. Uden kommandoer vises planen kun.

Modus pr. tidsrum:

- **Hold**: prisen er under dagens gennemsnit, og en senere time er mindst *prisforskellen* dyrere.
- **Lad fra nettet**: kun hvis "Må lade fra nettet" er slået til, der er plads op til maks-SoC, og de
  dyreste timer bagefter (ganget med virkningsgraden) er mindst prisforskellen dyrere end nu.
  De billigste timer vælges, indtil batteriet kan fyldes.
- **Normal**: alt andet – batteriet lader fra sol og forsyner huset.

Kommandoer sendes kun ved skift af modus (stop på den gamle modus før start på den nye). Knapperne
Auto / Normal / Hold nu / Lad fra net nu tilsidesætter planen, indtil Auto vælges igen.

**Solprognose-regel**: "Lad kun fra net hvis solprognose < X kWh" bruger prognose-sensorerne fra
Konfigurer (i dag / i morgen). Er dagens prognose mindst X, springes netopladning over den dag, både
for prisforskel-reglen og ugeplanens mål-SoC. Uden prognose-sensor har reglen ingen effekt.

Alle klokkeslæt indtastes som TT:MM i 24-timers format (fx 06:30); "630" og "1830" rettes automatisk.

**Ugeplan for batteriet**: pr. ugedag sættes *Til* (smart styring den dag), *Kilde* (*Kun sol* eller
*Sol + billige timer*, dvs. om der må lades fra nettet den dag), og valgfrit *Mål-SoC* med *Fuldt senest*: batteriet fyldes til niveauet i de
billigste timer inden klokkeslættet, fx 100 % senest kl. 17 før aftenens dyre timer. Uden mål-SoC
lader batteriet kun fra nettet efter prisforskel-reglen. Rækken "Alle dage" sætter alle syv.

Alle tal i panelet er live fra Home Assistants states; plan og status hentes hvert 3. sekund, og
planen genberegnes hvert minut samt straks efter ændringer i pris- og SoC-sensorer.

## Udvikling

```bash
python3.14 -m venv .venv
.venv/bin/pip install -r requirements_test.txt
.venv/bin/pip install "$(.venv/bin/python scripts/frontend_requirement.py)"
.venv/bin/python -m pytest -q
```

Nye versioner udgives ved at sætte `version` i `manifest.json` og pushe et tag `vX.Y.Z`;
GitHub Actions opretter en release, som HACS viser som version.

## Manuel installation

Kopiér mappen `custom_components/electricity_optimizer` til `config/custom_components/` i din
Home Assistant-installation og genstart.

## Struktur

```
custom_components/electricity_optimizer/
├── __init__.py            # registrerer statisk sti og sidebar-panel
├── config_flow.py         # opsætning + Konfigurer: prissensor og solcelle-sensorer
├── storage.py             # lagring af biler (HA Store)
├── ev_controller.py       # ladeplan for elbiler
├── battery_controller.py  # modus-plan for husbatteri
├── optimizer.py           # samler regler, elbiler og batteri i én beregning
├── commands.py            # generiske start/stop-kommandoer (switch/button/script/select/number)
├── websocket.py           # API som panelet bruger
├── const.py
├── manifest.json
├── strings.json
├── translations/          # da, en
└── frontend/
    └── electricity-optimizer-panel.js   # panelet (web component, ingen build-step)
```

Release notes for hver version står i [CHANGELOG.md](CHANGELOG.md) og vises i HACS ved opdatering.

## Notifikationer og fejlsøgning

Electricity Optimizer viser en notifikation i Home Assistant, når en elbil ikke kan nå sit mål-SoC inden deadline,
når en bil skulle lade men ikke er tilsluttet, og når en kommando til bil eller husbatteri fejler. Slå dem fra
under Regler for opladning. Hændelsen `electricity_optimizer_notification` (med `key`, `title` og `message`)
sendes altid, så du kan bygge automationer, fx en besked til din telefon.

Ved hver start-/stop-entitet i Rediger-formularen er der en Test-knap, der sender kommandoen med det samme og viser
resultatet. Under Indstillinger → Integrationer → Electricity Optimizer kan du hente diagnostik (konfiguration, regler, biler
med status, husbatteri, seneste beregning, sensorernes tilstand og de seneste ladeperioder) til fejlsøgning.
