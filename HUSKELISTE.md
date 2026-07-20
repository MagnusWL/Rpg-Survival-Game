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

## Set, men ikke gjort noget ved

**Vandpytterne rammer skævt på telefon.** Der er 196 pladser i
`assets/sprites/effects/puddles.json`, men kun **23 af dem (12%) er inden for
skærmen** på en iPhone 12 — resten ligger på den del af baggrunden som beskæres
væk. Ringene har 60 pladser at vælge imellem, så de fleste af dem lander et sted
ingen kan se. Filtrerer vi til de synlige, bliver det markant travlere omkring
ridderen.

**Introen fortæller ikke at man kan trykke sig videre.** Det virker, men en
spiller opdager det ikke af sig selv.

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
