# Huskeliste — ting vi har skubbet til side

Alt herunder ligger i koden lige nu. Intet af det er glemt, men intet af det er
færdigt heller. Filen er kun til os to og kan slettes inden PR'en.

Sidst gennemgået 20. juli 2026.

---

## Slukket, men ligger klar

**Møntsæk-sliders** — `DEBUG_COINSACK_TUNING` i `App.tsx` (~linje 757).
Sæt til `true`, så kommer panelet med placering, bredde og "smid en mønt" tilbage.
Tallene den fandt frem til står allerede i `COINSACK_LEFT` / `_BOTTOM` / `_WIDTH`.

**Rim light-sliders** — `DEBUG_RIM_TUNING` i `App.tsx` (~linje 357).
Sæt til `true` for farve, styrke og blandingsmåde på ridderens månekant.
Værdierne står i `RIM_STYLE` lige over.

Begge paneler deler `DebugSlider` og `tunePanel`-stilarterne. De koster intet
når de er slukket — de bliver slet ikke tegnet.

---

## Midlertidigt synligt i spillet

**"Continue · Test run"** nederst i menuen. Designet har én knap, og de to her
er parkeret nede i hjørnet med lille skrift indtil det er afgjort hvor de hører
hjemme.

**Ordet `LOGO`** i introen er ren tekst i plakatens blodrøde. Den venter på
rigtig logografik — ét sted at skifte, i `IntroSequence.tsx`.

---

## Virker kun i browseren

Møntsækken, RESCUE HER-knappens tear-effekt og de tre intro-effekter (ild, øjne,
tåge) er alle canvas. React Native har ikke canvas, så **på en telefon tegner de
ingenting**.

Historiebillederne vises stadig — de står bare stille. Menuknappen falder tilbage
til et almindeligt billede. Møntsækken forsvinder helt.

Det mest sandsynlige svar er en WebView. Hver effekt er én selvstændig fil, så
det er det eneste sted der skal ændres. Det er ikke noget vi skal beslutte i
forbifarten.

---

## Kræver genbygning, ikke en slider

**Rim light: retning og rækkevidde.** `toLight` og `band` i `RIM` øverst i
`tools/build-sprites.mjs`. Farve og styrke kan skrues live; disse to er selve
formen på lyset og regnes ud når arkene bygges. Kør `npm run build:sprites`
bagefter — det tager få sekunder.

---

## Fra menu-manualen mangler den ene af to

`Grafik/Menu/Mobile game menu buttons3/MANUAL-effekter.md` beder om to ting.

- **Effekt 2 — glimt hen over CRUEL:** ✅ inde, og motorens kode er linje for
  linje den samme som manualens.
- **Effekt 1 — knappen skal svæve og gløde i hvile:** ❌ ikke lavet. Det er ren
  CSS i manualen, men vores knap er et canvas, så den skal løses lidt anderledes.
  Manualen advarer selv om at svævet kan kollidere med tear-animationen.

---

## Kampfølelsen: flinch → spark (bygget 20. juli, aften — plan A)

Nicolais sekvens er inde: rammes han mellem sving, flincher han, og hvis
nogen stadig står inden for 70 px i en 120°-vifte foran ham, **sparker han
dem væk** — skubbet der før red usynligt på det skjulte sving, leveres nu af
sparket (frame 6, hvor benet er ude). Bevægelse afbryder sparket, og et
afbrudt spark skubber ingen. Skadestal er urørte — kun skub og animation.

Sparket kommer kun **halvdelen af gangene** (ét møntkast i det øjeblik
flinchen slutter — Nicolais valg, 20. juli). Taber mønten, rejser han sig
bare, og ingen bliver skubbet den gang: skubbet bor på sparket, så uden
spark intet skub. Sparket gør ingen skade nogensinde — skaden faldt
allerede med svinget.

**Ikke set i drift endnu:** forhåndsvisningen frøs under alle forsøg, så
sekvensen hurt→kick er bevist i logik og typecheck, ikke med øjne. Nicolai
tester ved at stille sig i en flok.

Lyden kom 20. juli (aften): Nicolais to spark-optagelser er inde som
`kick-1`/`kick-2` — gennem lydmøllen som alt andet, så deres meget høje
niveau er lagt på husets (snittet lander lige under sværdsvingene, så de
burde passe ind uden videre). Klippet vælges tilfældigt, startes tidligt
med sit eget målte optræk så fuld styrke rammer kontakt-frame 6, og det
tier hvis sparket afbrydes af bevægelse. **Skal de dæmpes/hæves:** giv
kick-linjerne et `level` i `tools/sound-config.mjs` og kør
`npm run build:sounds`.

**Åbent stadig:**
- Plan B fra diskussionen (skaden venter også på sparket) er stadig kun en
  tanke — det er balancearbejde og skal over Magnus's bord.
- Kontaktframe (6), rækkevidde (70), vifte (120°) og chancen (50%,
  `KICK_CHANCE`) er førstegæt til Nicolais øjne.

---

## Tre nye ridder-animationer (20. juli, nat)

**Die — faldet.** Spillet frøs før i samme sekund som det dræbende slag; nu
får faldet sin scenetid: marken simulerer videre, mens han går ned (14 fps
plus 0,45 s hvil på sidste billede, ~1,5 s i alt), og først derefter kommer
game over-skærmen. Guld, gemmer og skærmen selv er urørte — de venter bare
på faldet. Mens han falder: ingen ordrer, ingen sving, ingen regeneration.
Slaget, der fældede ham, høres stadig.

**Rupture (Special1) ved Cone** og **Ancestor (Special2) ved Summon** —
Nicolais navne på kastene. Posen spilles i det øjeblik, skillen fyres af;
selve skillens virkning er præcis som før (Magnus's kode — kun ét mærket
linjepar pr. sted). Kastes der i løb, springes posen over, og bevægelse
afbryder den — samme regel som sparket.

**Førstegæt til Nicolais øjne:** die 14 fps + 0,45 s hvil; begge kast 18 fps.
Ruptures koreografi står **skrevet helt ud** i `order` på `ANIMS.rupture`,
og den nuværende liste er **Nicolais egen** — han skrev den selv i
trin-notationen (20. juli): åndedrag 0,3 s på billede 7, tre sving
12↔13, frysning 0,5 s på 13, hale — 1,86 s i alt. Hvert trin i listen er
ét vist billede og kan bære sin egen pause; `order` findes på enhver
animation og trumfer `passes`/`holds`.

**Cone-zonen tegnes nu** (`CONE_ZONE` i App.tsx). Første forsøg var
flyvende splinter — Nicolais dom: *"bare en bunke store pixels der blæser
op"*. Det han ville have, var **selve angrebszonen synliggjort** med et
tæppe af små pixels. Version 2 gør det: keglens to kanter tegnes som
ubrudte pixel-streger, og indenfor ligger en dither, der er tættest ved
støvlerne og tynder ud — tændt udefter som en lunte (1500 px/s, hele
vejen på ~0,53 s), holdt, og opløst over 0,7 s. I alt 2 sekunder.

Hvorfor kanter: zonen er *enorm* (42° × hele banen), og et jævnt tæppe
ville koste 800+ pixels eller læse som støv. En optegnet kant koster kun
længde — ikke areal.

**Pixelstørrelsen halveret til 4 px** (Nicolai, 21. juli). Halvering
firedobler kandidaterne, så fyldets tæthed blev skruet tilsvarende ned —
finere korn, ikke firedobbelt pris: værste simulerede tilfælde 599 mod
loftet 600 (mod 374/426 ved 8 px). Kanten beholdt sin tykkelse; den
bærer formen.

**Zonen venter nu på billede 13** i Ruptures koreografi — 967 ms efter
kastet (Nicolai, 21. juli). Ventetiden er ikke skrevet som et tal men
*regnet ud af koreografien* (`frameStartTime(ANIMS.rupture, 12)`), så
den flytter sig selv, hvis `order` skrives om. Det er en timer, ikke en
vagt på selve animationen — så et kast i løb, hvor posen springes over,
stadig oplyser jorden. **Ikke set med øjne endnu:** ruden frøs (1 fps,
cooldown løb aldrig ud), så 589 pixels à 4 px og de 967 ms er målt/
udregnet, ikke beskuet. 8-px-udgaven var derimod set og målt: dom
449→816, 220 fps, hak 0.

Gitteret er skærmens, ikke kastets — pixels ville blive til skæve rudere,
hvis tæppet blev roteret på plads. Testen for hver pixel er *keglens egen*
(rækkevidde + halvvinkel), altså samme spørgsmål som skaden stiller, så
det der lyser op, er det der rammes. Ren dekoration — skaden var og er
øjeblikkelig.

**Stadionbølgen = slaget** (Nicolai, 21. juli, tredje omgang). Pixlerne
ligger nu på **buer** med 36 px mellemrum i stedet for spredt tilfældigt.
Fronten er selv en ring af konstant afstand, så den rammer en hel bue på
samme øjeblik og tænder den som **én streg**, der derefter rejser udad —
det er dén, man skal forstå slår. Stregen er stiplet (halvdelen af buens
pixels): en massiv streg koster det dobbelte og læser ikke bedre.

En pixels liv, i én animation (1,5 s): fronten rammer → den blusser op og
svulmer til 2,4× → springer 8–28 px → falder → lille efterhop → **dæmpes
til ca. halv styrke** (så den lysende streg er fronten alene, og alt bag
den er gløder) → **driver langsomt 16 px opad og toner ud**.

Tre ting følger gratis af, at drift og udtoning bor på pixlen selv i
stedet for på laget: zonen **toner ud fra spidsen og udad**, fordi de
nære pixels begyndte først; der er ingen fælles udtoning, der får det
hele til at forsvinde som et lagen; og bølgen behøver ingen ekstra
elementer.

Første forsøg var **dødt, og regnestykket forklarer hvorfor:** 5 px hop
delt i 8 trin = 0,6 px ad gangen, mindre end én pixel — ingen bevægelse
overhovedet. Alle løft er nu hele multipla af pixlen i 4 trin.

**Hakket i den opadgående drift var ikke tunghed** — det var mit valg af
4 trin, som over et helt sekund blev til ét ryk hvert kvarte sekund.
Nicolai så det med det samme og troede det var lag. Løst med en
tidsfunktion *inde i* nøglebilledet ved 34% (`animationTimingFunction:
'linear'`), som kun styrer intervallet derfra: springet beholder sit
hak, stigningen glider. Verificeret i den kompilerede regel — RNW
sender per-keyframe timing igennem.

**Pixlen halveret igen til 2 px** (21. juli) — en tyvendedel af ridderens
bredde. Buerne blev tilsvarende færre (52 px) og tyndere (0,4), kant og
dither skruet ned; 672 pixels i simuleringen, stregen vokser 8 → 88.

Kanten er **tonet ned** (tæthed 0,55, alfa ~0,3) — buerne har overtaget
jobbet med at vise formen.

**Skaden rider nu på bølgen** (`CONE_DAMAGE_RIDES_WAVE`, Nicolais
udtrykkelige ja 21. juli — den ENE gameplay-ændring i hele effekten).
Zombierne tager først skade og blinker rødt, når stregen når dem: 1,0 s
for en helt tæt på, 1,3 s på 400 px, op til 1,7 s yderst. **Tallene er
Magnus's urørte** — `fireCone` afgør stadig hvem der rammes og hvor
hårdt, i kastets øjeblik; den bliver bare kaldt for sit sigte og sin
udregning, og dens færdigskadede liste kasseres bevidst. Målene er
**låst ved kastet** (går en zombie ud af keglen, rammes den alligevel —
du sigtede der), og en ventende træffer på en allerede død springes over.
Leveringen sker lige før brand-kæden, så et drab her tæller som ethvert
andet drab samme frame. **Rul tilbage:** sæt flaget til `false`, så
lander alt igen på trykket.

Bemærk: keglen gav **slet ikke rødt blink før** — `fireCone` trak bare
liv fra. Blinket er altså ny gevinst, ikke noget vi har flyttet.

**Drejeknapper i `CONE_ZONE`:** `cell` (pixelstørrelse), `arcGap`/
`arcDensity` (stregernes afstand og stiplethed), `edgeBand`/`edgeDensity`
(kantens tykkelse/tæthed), `fillNear`/`fillFar`/`fillFalloff` (ditheren
mellem stregerne), `sweepSpeed` (bølgens fart), `cellLifeMs` (en pixels
levetid), `drift` (hvor langt den driver op), `hopSteps` (hakketheden),
`CONE_HOPS` (de seks spring), farverne, og `maxCells` (loftet — 640;
værste simulerede tilfælde 640). Hele kastets levetid regnes ud af
farten og levetiden (`CONE_ZONE_MS`), så intet klippes midt i driften.

Keglens facit i øvrigt: vinklen er 42° (2×21), rækkevidden hele banens
diagonal (~765 px) — skaden når altid forbi skærmkanten. Sigte-trekanten
(`renderCone`/`aimingAbility`) er stadig **død kode** — intet starter
sigtet; formentlig bænket da kvik-kast-bjælken kom. Skal over Magnus's
bord, hvis sigtet skal genoplives eller ryddes op.

Ancestor spiller **frem → tilbage → frem igen** (`passes` på `ANIMS.ancestor`,
Nicolais figur, 20. juli) og ender stående på sidste billede — 2,4 s i alt.
Vendepunkterne deler billede, så den drejer i stedet for at hakke. `holds` og
`passes` kan kombineres frit, også på andre animationer.

**ShieldBlockMid er IKKE bygget** — Nicolai: den skal trigge under et bestemt
item, grenen findes senere. Kilden ligger klar i `Grafik/Knight`; den føjes
til `SHEETS` i `tools/build-sprites.mjs`, når den får sin krog (et bygget
ark er monteret altid og koster hukommelse, så den venter med vilje).

---

## Zombien falder også (20. juli, nat)

ZombieMale2's to dødsanimationer (`Die`/`Die2`) er inde som et **rent visuelt
lig-lag**: fjenden forlader spillets lister i præcis samme frame som før —
loot, guld, bølge-tælling, sigte og spark-viften er urørte — men kroppen
bliver liggende, hvor den faldt: fald (14 fps, ~1,1 s), hvile (1,4 s), og
0,6 s udtoning. Tilfældigt valg af de to pr. død, så en mejet flok ikke
falder i takt. Kun nærkamps-zombien — cirklerne (ranged/boss) forsvinder
stadig bare, for de har ingen krop at falde med. Ligene deltager i
dybde-sorteringen, så levende går foran dem, og de ældes på simulationens
ur (pause fryser dem midt i faldet). Tal til øjnene: `CORPSE_LINGER` /
`CORPSE_FADE` i `App.tsx` + fps i `MOB_DIE_ANIMS`.

---

## Hvordan vi laver effekter fremover (aftalt 21. juli)

Nicolai spurgte om det ville være lettere at **tegne** effekterne. Svaret er
ja — og ikke en smule, men en helt anden størrelsesorden:

| | elementer | koster |
|---|---|---|
| Tegnet ark (ridderen, en zombie) | **1** | ingenting |
| Regn | ~250 | fint |
| Kegle-zonen | ~680 | mærkes |

Et tegnet ark er **ét** element, uanset hvor mange detaljer der er i
billedet — browseren tegner ét billede. Genererede pixels koster ét element
**hver**, og hvert eneste skal beregnes, animeres og sammensættes for sig.
**Detaljer er gratis i en tegning og lineært dyre i kode.**

**Reglen fremover:** spørg altid først "kan det her være en tegning?" Har
effekten et fast udseende — ild, eksplosion, magi, et slag — så tegn den som
et ark med **8 rækker (én pr. retning, ligesom ridderen)**, så intet skal
roteres. Kode-genererede effekter er kun til det, der skal følge levende tal:
regn der skal dække enhver skærm, ringe der skal ramme rigtigt vand, en kegle
der skal matche sin sande vinkel.

**Kegle-zonen er slanket 21. juli:** 680 → **428 pixels** (loft 420), og 394
af dem er selve stregerne. Færre buer (96 px imellem i stedet for 52), kant og
dither næsten væk. Det blev både billigere *og* renere — nu er ni tiendedele
af det tegnede dét, øjet skal følge.

**Den rigtige løsning, hvis det stadig er for tungt — "bagning":** vi behøver
ikke at *tegne* noget. Et byggescript kan **regne effekten ud på forhånd** med
præcis den matematik, der allerede står i koden, og gemme den som et
sprite-ark. Ingen tegneopgave for nogen. To udgaver, målt 21. juli:

**A — bag hele keglen.** Udfoldet fylder den 789 × 650 px pr. billede:

| opløsning | 20 billeder | i hukommelsen |
|---|---|---|
| fuld | 10,3 mio. px | **39 MB** — for meget |
| halv | 2,6 mio. px | **9,8 MB** ≈ ét zombie-ark |
| kvart | 0,6 mio. px | 2,4 MB, men 2-px-pixels bliver til en halv |

Så halv opløsning vist i dobbelt størrelse med skarp (nearest-neighbour)
skalering. Prisen: **428 elementer → 1**, mod ~10 MB hukommelse. Alle kast
bliver ens, og roterede pixels bliver en anelse bløde.

**B — bag kun stregen** (bedre, hvis A er for dyr). Buerne er 394 af de 428
pixels, altså næsten hele effekten. Bag én streg som et lille ark og lad
spilløkken flytte og skalere den udad, ligesom den flytter zombier. Så er det
**en håndfuld elementer og et billede på under en MB**. Kræver at halen af
gløder tænkes om.

Ingen af dem er bygget. Test den slankede udgave (428) først — er den god nok
på Nicolais maskine, sparer vi hele arbejdet.

---

## Kraniet er parkeret — godkendt, men venter på sin plads

Kronekraniet (`Cranium-Coin-bag`) er inde, virker og er **godkendt af Nicolai**
("den er flot") — men det er slået fra 20. juli om aftenen, så det ikke koster
en frame mens det venter. Slukket betyder helt væk: ingen motor, ingen fysik,
og dets 17 filer hentes heller ikke ved start.

**Kald det frem igen:** sæt `COINSACK_ENABLED = true` i `App.tsx`, og
`DEBUG_COINSACK_TUNING = true` for placerings-sliderne. Puslespillet der
venter: standardpladsen (68/8/254) ligger bag **Magnus's nye Ranged-knap** fra
hans loadout-bjælke — det var derfor han selv bænkede den gamle pung. Under
254 i bredde blødgøres pixel-looket (buffer 1:1 ved præcis 254).

Den gamle snoresæk ligger stadig urørt til fortrydelse: `vendor/coin-sack/`
plus kunsten i `assets/coinsack/14f/` og `shade.png` — lydene er de samme
filer. Når et af de to designs er endeligt, ryddes det andet op inden PR'en.

---

## Set, men ikke gjort noget ved

**Introen fortæller ikke at man kan trykke sig videre.** Det virker, men en
spiller opdager det ikke af sig selv.

**Hak-jagtens stilling (20. juli, aften):** vejret var hovedsynderen og er
løst — CSS-loops, 10 synlige ringe, regn i 15 fps stop-motion, 230 dråber.
60-loftet på spilløkken tog derefter det hvilende hak ("bedre fps" — Nicolai,
efter test). Vandpyt-problemet fra tidligere på listen er løst i samme ombæring:
ringene deles nu kun ud over synligt vand.

Ikke målt endnu, hvis der jages videre: møntsækkens matter.js-løkke (kører
altid, også tom — kunne få en A/B-kontakt som vejret), zombie-ark der pakkes
ud ved første møde med en ny fjendetype (op til 5 × 7,5 MB midt i kampen —
kunne varmes op under den sorte fade), og flash-laget der monteres ved
træffere. Målepanelet og de to
kontakter (DEBUG_PERF i App.tsx) står klar til jagten.

---

## Løst i mappen

- `test.png` ligger i projektroden og er ikke i git. Formentlig affald.
- Grenen `coinbag-first-attempt` findes stadig — det var det første forsøg på
  møntsækken, som blev kasseret.
- **21 ridder-animationer i `Grafik/Knight` bygges ikke:** 180Turn, CastSpell,
  CrouchIdle, CrouchRun, FrontFlip, Idle2, Melee2, MeleeRun, MeleeSpin,
  Pummel, Rolling, Run up No sword, RunBackwards, ShieldBlockMid,
  ShieldBlockStart, Slide, SlideEnd, SlideStart, StrafeLeft, StrafeRight,
  Walk.
  10 er i spillet (idle, walk, run, melee, takedamage, unsheath, kick, die,
  special1, special2). `Walk` (med sværd) er holdt ude fordi kun indgangen
  går, og der har han ikke trukket endnu.

- **Melee2 er øremærket, ikke glemt** (Nicolai, 20. juli): gemt til "noget
  kombo-halløj når helten bliver vildere" — altså sving-variation eller en
  kombo-kæde, når den tid kommer. Det er hans næststørste ark (103×125 af
  cellens 128, rører kanten — derfor beskæres celler aldrig), og møllen
  tager den ind med én linje i `SHEETS`, når den skal bruges.
