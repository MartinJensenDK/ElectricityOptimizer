# Changelog

Alle ændringer i Electricity Optimizer. Afsnittet for en version bruges som release notes på GitHub og vises i HACS, når du opdaterer.

## 0.16.0

- Regler: "Sol: start/stop efter (min)" er erstattet af tre enkle felter. "Elbil-sol: batteri ≥ (%)" stopper elbilens sol-ladning, når husbatteriet falder under grænsen (gælder nu uanset hvem der har sol først). "Elbil-sol: sol ≥ (W)" kræver, at solcellerne producerer mindst X W "… i mindst (min)", før bilen starter, og stopper igen efter samme tid under grænsen. Minut-feltet bruges også som start/stop-forsinkelse for sol-overskuddet.
- Nye elbil-statusser: "Venter på solproduktion" og "Mangler solcelle-sensor" (sæt solcelle-effekt under Konfigurer).
- Forsiden: Husforbrug er nu en gauge fra 0 til 5 kW.
- "Sådan bruges solstrømmen" beskriver de aktuelle betingelser for sol-ladning.
- Release notes vises nu i HACS ved opdatering.

## 0.15.0

- Forsiden: gauges for solceller (0 til maks. kWp, altid gul/orange), elnet (køb rød til venstre, salg grøn til højre), batteri-effekt (minus ved afladning) og husbatteri-% (0–100, rød ved reserven).

## 0.14.0

- Regler for opladning forenklet: korte overskrifter på én linje, (i)-ikon med forklaring ved hvert felt, og felter uden betydning skjules.

## 0.13.0

- Forsiden: Batteri effekt vises som halvcirkel-gauge med de kendte farver.

## 0.12.0

- Forsiden: priskortene over diagrammet er fjernet. Diagrammet har en lodret nu-streg med prisen lige nu i toppen, og elbilernes planlagte ladetimer er tegnet ind med en farve pr. bil.

## 0.11.2

- Hus batteri: planvisningen matcher elbilernes (samme højde, timeinddeling, dagsmarkører og forklaring).

## 0.11.1

- Forsiden: Elnet står før Hus batteri, og et nyt kort viser batteriets effekt i W.

## 0.11.0

- Kilde (kun sol / sol + billige timer / kun billige timer) vælges pr. ugedag for både elbiler og husbatteri.

## 0.10.1

- Indstillingsfelter står på én linje; kompakte felter i ugeplanen.

## 0.10.0

- Forsiden: live-række med solproduktion, husforbrug, batteri og elnet.

## 0.9.0

- Hus batteri: lad kun fra nettet, når solprognosen for dagen er under X kWh. Tidspunkter i 24-timers format.

## 0.8.0

- Ugeplan for husbatteriet (til/fra, netopladning, fuldt senest, mål-SoC pr. dag). Elbilernes ugeplan vises altid.

## 0.7.4

- Versions-banneret fra 0.6.1 er fjernet igen.

## 0.7.0 – 0.7.3

- Ugeplan pr. elbil (til/fra, klar senest, mål-SoC pr. ugedag).
- Panel-scriptet serveres fra en versioneret sti, så proxyer ikke viser en gammel udgave.

## 0.6.0 – 0.6.1

- Regler for opladning: sol-overskud, prioritering mellem elbil og husbatteri, hovedsikring, min./maks. ladestrøm og ladeeffekt-sensor pr. bil.

## 0.5.0

- Elbil: ladehastighed i ampere (A) i stedet for kW, antal faser og valgfri strømgrænse-entitet.

## 0.4.0 – 0.4.2

- Fanen Hus batteri: live status, regler for normal/hold/lad fra nettet, manuel styring.
- Rettelser: opsætningsformularen mistede ikke længere værdier, og fanerne Solceller/Elbiler viste ikke længere batteri-siden.

## 0.3.0

- Fanen Elbiler: flere biler med SoC-, start- og stop-entitet, smart opladning i de billigste timer inden deadline.
