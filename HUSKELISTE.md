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

**ShieldBlockMid er IKKE bygget** — Nicolai: den skal trigge under et bestemt
item, grenen findes senere. Kilden ligger klar i `Grafik/Knight`; den føjes
til `SHEETS` i `tools/build-sprites.mjs`, når den får sin krog (et bygget
ark er monteret altid og koster hukommelse, så den venter med vilje).

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
