# Changelog

Alle ændringer i Electricity Optimizer. Afsnittet for en version bruges som release notes på GitHub og vises i HACS, når du opdaterer.

## 0.30.0

- Forsiden: nyt kort "Elbiler" ved siden af Hus batteri med et batteri-ikon pr. bil. Fyldes efter bilens ladestand (rød under 20 %, orange under 40 %, ellers grøn), dagens mål-SoC vises som stiplet streg, og et lyn viser, at bilen lader lige nu.

## 0.29.1

- Forsiden: målerne står nu 4 på første række (Solceller, Forbrug, Elnet, Batteri effekt). Hus batteri-måleren er fjernet, og batteri-ikonet hedder nu "Hus batteri" og står alene på anden række.
- På skærme under 1100 px lægger Status-kortet sig under målerne, så de ikke bliver for små.

## 0.29.0

- Forsiden: nyt kort "Batteri niveau" ved siden af Hus batteri-måleren. Det viser husbatteriet som et batteri, der fyldes op efter ladestanden, i samme farver som måleren (rød ved reserven, orange tæt på, ellers grøn), med reserven som stiplet streg og de kWh, der cirka er tilbage.

## 0.28.0

- "Regler for opladning" er flyttet fra forsiden og ligger nu nederst på både Elbiler-fanen og Hus batteri-fanen. Det er de samme indstillinger begge steder.
- Linket "Regler" på Solceller-fanen fører nu til Elbiler-fanen.

## 0.27.1

- Solceller, Anlæg-kortet: rækkerne "Produceret denne uge", "Produceret i år" og "Effekt-sensor" er fjernet. Kortet viser nu installeret effekt, produceret i dag, produceret denne måned og solens retning.
- De valgfrie sensorer for uge og år er fjernet fra Konfigurer.

## 0.27.0

- Forsiden: Status-kortet er flyttet op ved siden af målerne. Målerne fylder nu 2 rækker til venstre, og Status-kortet står i fuld højde til højre.
- På smalle skærme (mobil) stables blokken igen under hinanden.

## 0.26.1

- Forsiden, Status-kortet: rækken Elbiler viser nu hver bils ladestatus (fx "Venter på solproduktion") i stedet for "Ingen lader", og mærkatet viser antal biler, der lader, eller den mest relevante status.

## 0.26.0

- Solceller: Anlæg-kortet viser "Produceret i dag" i stedet for "Produceret i alt" samt "Produceret denne uge", "denne måned" og "i år" fra tre nye valgfrie energi-sensorer under Konfigurer. "Solcelleproduktion i alt" er fjernet fra konfigurationen.

## 0.25.2

- Rediger-formularerne for elbil og husbatteri er sat op i sektioner med ens kolonner og felter på linje: Bil / Lader / Plan for elbiler, og Sensorer / Batteri / Kommandoer for husbatteriet.

## 0.25.1

- Forsiden: "Husforbrug" hedder nu "Forbrug". Gaugen viser husforbruget i blå og elbilernes ladning som et ekstra segment i lilla, og teksten under siger "heraf X W husforbrug · Y W elbil".

## 0.25.0

- Sol prioritet i tre zoner for husbatteriet som nr. 1: over "Prioriter indtil (%)" vinder bilen (eksport + batteriets ladeeffekt, og batteriet må aflade til bilen); mellem det nye "EV buffer (%)" og "Prioriter indtil" har batteriet forrang, og bilen kører højst med min. ladestrøm (starter kun, hvis solen alene dækker den); under "EV buffer" stopper bilen. EV buffer holdes altid under Prioriter indtil.
- "Prioriter under (%)" er fjernet (altid 0), og "Prioriter over (%)" hedder nu "Prioriter indtil (%)".
- Ny elbil-status "Lader fra sol – min. strøm".

## 0.24.0

- Ny regel "Husbatteri må lade bilen over øvre grænse" (standard til, vises med husbatteri som nr. 1): er batteriet over "Prioriter over", må dets ledige afladeeffekt bruges til at lade bilen, når solen ikke rækker. Falder batteriet under grænsen, stopper bilen igen. Slået fra: bilen får kun solstrøm, og batteriets afladning trækkes fra som før.

## 0.23.0

- Sol prioritet: uden for intervallet vinder nr. 2 i stedet for "normal" brug. Med husbatteri som nr. 1 og intervallet 80–90 % får elbilen nu eksporten plus det, batteriet ellers ville lade med, når batteriet er over 90 % (eller under 80 %). Med elbil som nr. 1 vinder husbatteriet uden for bilens interval.

## 0.22.3

- Solopladning: det, husbatteriet aflader med, trækkes nu fra sol-overskuddet, uanset om overskuddet beregnes fra elnet-sensoren eller fra solproduktion − husforbrug. Før kunne bilen blive ved med at lade på husbatteriet, fordi batteriet dækkede underskuddet og nettet viste balance.

## 0.22.2

- Regler for opladning er sat op i tre ryddelige sektioner (Prioritering, Sol-ladning, Elnet) med ens kolonner og felter på linje. Sol prioritet er en vandret liste, der stadig kan trækkes eller byttes, og afkrydsningerne står samlet på én række.

## 0.22.1

- Elbil: status siger ikke længere "Lader", når bilen ikke gør det. Med en ladeeffekt-sensor vises "Starter ikke – 0 W", hvis bilen trækker under 100 W tre minutter efter start, og start-kommandoen gensendes hvert 5. minut. Bliver start-kommandoen afvist af laderens integration, vises "Start fejlede" med fejlteksten, og der prøves igen ved næste beregning.
- Historik: med en ladeeffekt-sensor tælles der ikke energi, når sensoren viser 0 W.

## 0.22.0

- Solopladning: når bilen starter, sendes kun start-kommandoen. Ladestrømmen (A) sendes første gang efter det valgte interval og justeres derefter højst så ofte. Nyt felt "Ladestrøm hvert (sek)" under Regler for opladning (standard 30 s). Stop sender som før kun stop-kommandoen.

## 0.21.1

- Forsiden: statusbar under fanerne med én chip pr. elbil og for husbatteriet: status (fx "Venter på solproduktion", "Lader fra sol", "Hold") og den korte årsag, fx "Solproduktion 300 W – kræver 1.500 W i 2 min" eller "Batteriet spares til dyrere timer senere". Klik på en chip for at gå til fanen.

## 0.21.0

- Regler: nyt valg "Sol-overskud beregnes fra". Med "Solproduktion − husforbrug" er den effekt, der er til rådighed for opladning, solcellernes produktion minus husets forbrug (minus det, husbatteriet lader med), så ladestrømmen følger solproduktionen direkte ved "Kun sol" og "Sol + billige timer". Standard er stadig elnet-sensoren (eksport).
- Nyt felt "Husforbruget inkluderer elbilens ladning" og en husforbrugs-sensor under "Vælg sensorer", hvis husbatteriet ikke har én.
- Regel-kortet viser solproduktion og husforbrug fra sidste beregning.

## 0.20.2

- "Lad nu" er nu en ægte manuel overstyring: den starter opladning med det samme, også når Smart opladning er slået fra, og også når bilen allerede er over sit mål-SoC. Den kører, til bilen er fuld, tages ud af laderen, eller du trykker "Stop Lad nu". Før blev trykket afvist stille, hvis Smart opladning var fra eller SoC var over målet.
- "Stop Lad nu" sender altid stop-kommandoen, også når Smart opladning er fra.

## 0.20.1

- Hus batteri: knappen "Rediger sensorer og kommandoer" i overskriften er erstattet af en knaprække nederst på Indstillinger-kortet med "Rediger" og "Slet", magen til bilkortene under Elbiler.

## 0.20.0

- Historik: nyt kort "Sendte kommandoer" med alle kommandoer, integrationen har sendt til ladere og husbatteri (tid, hvem, handling, entitet, service, OK/fejl). De seneste 300 gemmes og er også med i diagnostik.
- Elbil og husbatteri: "Test"-knap ved hver start-/stop-entitet i Rediger-formularen. Sender kommandoen med det samme og viser, om Home Assistant tog imod den, eller hvad der gik galt (fx en entitet, der ikke findes).
- Bilens kort viser nu også "sæt ladestrøm" som sidste kommando og markerer, at kommandoen blev sendt.
- Alle kommandoer logges på info-niveau i Home Assistants log.

## 0.19.1

- Elbil: "Lad nu", stop af "Lad nu" og ændring af start-/stop-entiteter sender nu altid kommandoen igen, også hvis integrationen troede, at laderen allerede var i den tilstand. Det gør, at stateless button-entiteter (fx Zaptec authorize/deauthorize) virker pålideligt.
- Elbil: min. ladestrøm højere end maks. ladestrøm afvises nu med en tydelig fejl i stedet for at blive rettet i det skjulte.

## 0.19.0

- Ny fane **Historik**: ladeperioder for elbiler og husbatteri med start/slut, kilde (sol/net), kWh, betalt, gennemsnitspris, sparet og SoC, samt sum for i dag, 7 dage og 30 dage. Sparet regnes som det, solstrømmen ville have kostet fra nettet, og for netopladning i forhold til dagens gennemsnitspris. Der gemmes 90 dage.
- Notifikationer i Home Assistant, når en elbil ikke kan nå mål-SoC inden deadline, når en bil skulle lade men ikke er tilsluttet, og når en kommando til bil eller husbatteri fejler. Kan slås fra under Regler for opladning. Hændelsen `electricity_optimizer_notification` sendes altid til brug i automationer.
- Diagnostik-download under Integrationer → Electricity Optimizer.

## 0.18.0

- Regler: "Sol først til" er nu en sorterbar liste "Sol prioritet" (træk rækkerne eller tryk ⇅), hvor nr. 1 altid vinder. To nye felter, "Prioriter over (%)" og "Prioriter under (%)", afgrænser nr. 1's ladestand: uden for intervallet prioriteres der ikke, og solstrømmen bruges normalt. Feltet "Elbil-sol: batteri ≥ (%)" er erstattet af intervallet (gamle værdier migreres).
- Forsiden: prisgrafen viser ladeperioder for biler og husbatteri som lyseblå felter med lodrette kanter fra start til forventet slut. Ved solopladning er slutningen et estimat, der flytter sig med solproduktion og husforbrug (stiplet kant).

## 0.17.0

- (i)-ikoner med forklaring på alle faner: hvert kort, hver måler, hvert indstillingsfelt og hver kolonne i ugeplanerne har nu et ikon, man kan holde musen over (eller tabbe til) for at læse, hvad det betyder og hvordan det bruges.

## 0.16.1

- Regler for opladning: en fremhævet linje under felterne viser nu med det samme, hvad valget i "Sol først til" og de øvrige felter betyder, så det er tydeligt, at ændringen er gemt.

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
