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

## Til eftertanke — Nicolai bad selv om påmindelsen

**Når ridderen tager skade, giver han stadig skade.** Fjendens træffer vinder
kun *billedet* (flinch vises i stedet for svinget), men slaget lander usynligt
med fuld kraft. Nicolai overvejer om det usynlige slag skal svækkes — fx 50% —
men skadestal er Magnus's domæne, så indtil videre røres intet. To mulige
tolkninger blev ridset op, hvis idéen tages op igen: kun ved sammenstød i
præcis samme frame, eller i hele flinch-vinduet (~0,7 s — den tolkning hvor
regel og billede altid passer sammen).

---

## Den gamle møntsæk ligger klar til fortrydelse

Kraniet (`Cranium-Coin-bag`) afløste snoresækken 20. juli. Den gamle kørsel
ligger urørt tilbage: `vendor/coin-sack/` plus kunsten i `assets/coinsack/14f/`
og `shade.png`. Vil Nicolai have sækken igen, er det CoinSackView der peges
tilbage — lydene er de samme filer. Bliver kraniet hængende, kan de gamle
mapper ryddes op inden PR'en.

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
- **25 ridder-animationer i `Grafik/Knight` bygges ikke:** 180Turn, CastSpell,
  CrouchIdle, CrouchRun, Die, FrontFlip, Idle2, Kick, Melee2, MeleeRun,
  MeleeSpin, Pummel, Rolling, Run up No sword, RunBackwards, ShieldBlockMid,
  ShieldBlockStart, Slide, SlideEnd, SlideStart, Special1, Special2,
  StrafeLeft, StrafeRight, Walk.
  Kun 6 er i spillet. `Die` er holdt ude med vilje — spilløkken stopper ved død,
  så den ville fryse på første billede. `Walk` (med sværd) er holdt ude fordi kun
  indgangen går, og der har han ikke trukket endnu.
