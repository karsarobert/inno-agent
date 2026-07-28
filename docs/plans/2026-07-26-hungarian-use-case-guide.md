# Magyar használati útmutató és képernyőkép-csere implementációs terve

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** A `docs/use-cases/` jelenlegi kínai Skill-tutorialját teljes magyar változatban publikálni, és mind a hat illusztrációját a futó, magyar felületű Inno Agentből készült képre cserélni.

**Architecture:** A jelenlegi kínai `skill-tutorial.md` marad változatlan kanonikus forrásként. Mellé kerül egy önálló `skill-tutorial.hu.md`, amely kizárólag a `docs/use-cases/assets/hu/` könyvtárban lévő magyar képekre hivatkozik. Így a fordítás nem írja felül a kínai dokumentumot vagy képeit, a Magyar README pedig a magyar útmutatóra mutat.

**Tech Stack:** Markdown, meglévő Vitest tesztkészlet, futó Inno Agent (`http://localhost:3000`), böngésző-alapú UI-validáció, PNG képernyőképek.

---

## Kiinduló leltár és hatókör

A repóban nincs `how-to/` nevű mappa; a feladatnak megfelelő anyag a `docs/use-cases/` könyvtárban található.

| Elem | Jelenlegi állapot | Tervezett cél |
|---|---|---|
| Útmutató | `docs/use-cases/skill-tutorial.md`, kínai, 335 sor | `docs/use-cases/skill-tutorial.hu.md`, teljes magyar fordítás |
| Illusztrációk | 6 kínai felületű PNG a `docs/use-cases/assets/` alatt | 6 azonos funkciót dokumentáló, magyar felületű PNG a `docs/use-cases/assets/hu/` alatt |
| Magyar belépési pont | `README.md` és `README.hu.md` még a kínai fájlra mutat | Mindkettő a magyar útmutatóra mutat |
| Angol belépési pont | `README.en.md` a kanonikus kínai útmutatóra mutat | Változatlan; nem része ennek a feladatnak |

**Határok:**
- Nem módosítjuk a meglévő kínai útmutatót és képeit.
- Nem fordítjuk le vagy írjuk át a felhasználók meglévő munkaterületeit, beszélgetéseit, Skilljeit.
- A technikai azonosítók, fájlnevek, parancsok és formátumok változatlanok maradnak: `agent.md`, `.skills/`, `SKILL.md`, `card-maker`, `grammar-checker`, `cards/`, CSV-fejlécek, frontmatter-kulcsok és az angol forrásszöveg.
- `docs/SYSTEM_DEPENDENCIES.md` nem használati útmutató, ezért nem része ennek a fordításnak.

## Képernyőkép-követelmények

Minden képnek valódi, futó alkalmazásból kell származnia, `html[lang]="hu"` állapotban. A képekben az alkalmazás kezelőfelülete és a létrehozott példaanyagok is magyarok; az angol nyelvtanulási mintaszöveg szándékosan marad angol.

| Célfájl | Bizonyítandó állapot |
|---|---|
| `assets/hu/01_new_workspace.png` | Új `ielts-prep` munkaterület létrehozása; magyar „Munkaterület”, „Új munkatér”, létrehozási vezérlők |
| `assets/hu/02_agent_create.png` | Magyar nyelvű Agent-visszaigazolás és az `agent.md` a munkaterület gyökerében |
| `assets/hu/03_skill_uploaded.png` | A `.skills/card-maker/SKILL.md` faelem és magyar Skill-tartalom előnézete |
| `assets/hu/04_vocab_explain.png` | Magyar magyarázatok az angol `proliferation`, `renewable`, `intermittent`, `viable` szavakhoz |
| `assets/hu/05_cards_result.png` | Magyar összesítő és `cards/renewable-energy.csv`; a CSV magyar jelentéseket tartalmaz |
| `assets/hu/06_skills_panel.png` | Magyar „Készségek” panel, aktív `grammar-checker`, magyar leírás, „Feltöltés” és frissítés vezérlők |

A képek fájlneveinek számozása megegyezik a meglévő sorozatéval, de nem írjuk felül a kínai PNG-ket. Egységes böngészőablakméretet kell használni, a privát adatokat, API-kulcsokat és helyi abszolút útvonalakat ki kell takarni, és a képet a tényleges tartalomra kell vágni.

---

### Task 1: Dokumentációs szerződés-teszt létrehozása

**Objective:** Automatikusan ellenőrizhetővé tenni, hogy a magyar útmutató csak létező magyar képekre hivatkozik és nem maradt benne kínai szöveg.

**Files:**
- Create: `apps/inno-agent/test/hungarian-use-case-docs.test.ts`
- Create later in Task 2: `docs/use-cases/skill-tutorial.hu.md`
- Create later in Task 3: `docs/use-cases/assets/hu/01_new_workspace.png` … `06_skills_panel.png`

**Step 1: Write the failing test**

A Vitest-teszt a repógyökérből olvassa a magyar Markdownot, majd:

```ts
const imageLinks = [...guide.matchAll(/]\((\.\/assets\/hu\/[^)]+\.png)\)/g)].map((match) => match[1]);
expect(imageLinks).toHaveLength(6);
expect(guide).not.toMatch(/[\u3400-\u9fff]/);
for (const link of imageLinks) expect(existsSync(resolve(dirname(guidePath), link))).toBe(true);
```

Külön állítsa, hogy szerepel a `# Inno Agent használati útmutatója` cím, az `agent.md`, a `.skills/card-maker/SKILL.md`, valamint a `grammar-checker` példa. Ez megakadályozza, hogy a fordításban eltűnjön egy alapvető fogalom vagy használhatatlan legyen a képlink.

**Step 2: Run the focused test to verify failure**

Run:

```bash
npx vitest run apps/inno-agent/test/hungarian-use-case-docs.test.ts
```

Expected: FAIL, mert a magyar útmutató és/vagy a hat kép még nem létezik.

**Step 3: Do not weaken the test**

A tesztet csak akkor módosítsuk, ha a fordítás funkcionális követelménye változik. Ne csökkentsük a képszámot és ne fogadjuk el a régi `assets/` könyvtárra mutató hivatkozást.

**Step 4: Commit proposal**

```bash
git add apps/inno-agent/test/hungarian-use-case-docs.test.ts
git commit -m "test: define Hungarian use-case guide contract"
```

---

### Task 2: A magyar útmutató szövegének létrehozása

**Objective:** A teljes kínai útmutató közérthető, szakmailag pontos magyar változatának elkészítése minden fejezettel, táblázattal, kódrészlettel és GYIK-kel.

**Files:**
- Create: `docs/use-cases/skill-tutorial.hu.md`

**Step 1: Strukturális transzformáció**

Másold át a `docs/use-cases/skill-tutorial.md` teljes, 1–8. fejezetes szerkezetét. A magyar fájlban legyenek ezek a fejezetcímek:

```markdown
# Inno Agent használati útmutatója: saját tanulási ügynök építése
## 1. A működés logikája
## 2. Új munkatér létrehozása
## 3. Az agent.md létrehozása
## 4. Szókártya-készítő Skill feltöltése
## 5. Teljes folyamat bemutatása
## 6. Iteráció és karbantartás
## 7. Globális Skill: minden munkatérben használható képesség
## 8. Gyakori kérdések
```

**Step 2: Translate executable example content without changing technical syntax**

A példa `agent.md` tartalma, a `card-maker.md` `description` mezője, triggerkifejezései, szabályai, CSV-oszlopának emberi feliratai és a `grammar-checker` leírása magyar legyen. Maradjanak változatlanok a YAML-kulcsok, fájlnevek, utak, Anki-kommentfejlécek és angol nyelvtanulási mintamondatok.

Példa a megőrzendő szerkezetre:

```markdown
---
name: card-maker
description: Angol tananyag szókincséből Anki-kompatibilis szókártyákat készít.
---
```

**Step 3: Localize UI references and alt text**

A kezelőfelületre utaló szövegek a magyar fordítások legyenek: „Munkaterület”, „Új munkatér”, „Előnézet”, „Készségek”, „Feltöltés”, „Frissítés”, „Szerkesztés”. A hat képhivatkozás kizárólag ezekre mutasson:

```markdown
![Magyar képleírás](./assets/hu/01_new_workspace.png)
```

**Step 4: Editorial quality review**

Ellenőrizd manuálisan, hogy:
- a terminológia következetes („munkatér”, „Skill”, „globális Skill”, „munkatérhez kötött Skill”);
- magyar a teljes magyarázó szöveg, táblázatok fejlécei és GYIK;
- a dokumentum nem ígér képernyőképen nem látható vezérlőt;
- a forrásdokumentum minden tartalmi blokkja megmaradt.

**Step 5: Run focused test**

Run:

```bash
npx vitest run apps/inno-agent/test/hungarian-use-case-docs.test.ts
```

Expected: továbbra is FAIL csak a még hiányzó hat képre.

**Step 6: Commit proposal**

```bash
git add docs/use-cases/skill-tutorial.hu.md
git commit -m "docs: add Hungarian Skill tutorial"
```

---

### Task 3: Reprodukálható magyar demóadatok és valódi alkalmazásképek készítése

**Objective:** A dokumentum mind a hat állítását a futó alkalmazás magyar nyelvű állapotával bizonyítani.

**Files:**
- Create: `docs/use-cases/assets/hu/01_new_workspace.png`
- Create: `docs/use-cases/assets/hu/02_agent_create.png`
- Create: `docs/use-cases/assets/hu/03_skill_uploaded.png`
- Create: `docs/use-cases/assets/hu/04_vocab_explain.png`
- Create: `docs/use-cases/assets/hu/05_cards_result.png`
- Create: `docs/use-cases/assets/hu/06_skills_panel.png`
- Temporary, not committed: a tiszta `ielts-prep` demó-munkatér, `agent.md`, `card-maker.md`, `grammar-checker.md` és a képkészítéshez létrejövő beszélgetések.

**Step 1: Prepare a clean capture session**

Indítsd el a frissen buildelt szervert, majd böngészőben töröld az `inno.locale` és `inno.content-locale` localStorage-kulcsokat, töltsd újra az oldalt, és ellenőrizd:

```js
({ htmlLang: document.documentElement.lang, uiLocale: localStorage.getItem("inno.locale") })
```

Expected: `htmlLang === "hu"`; a mentett UI-locale lehet `null`, mert a magyar az alkalmazás fallbackje.

**Step 2: Create controlled Hungarian fixtures**

Hozz létre egy új `ielts-prep` munkateret. A `agent.md` és `card-maker.md` példaanyag magyar legyen, és ugyanazt a tanulási forgatókönyvet valósítsa meg, amelyet az útmutató leír. A globális `grammar-checker` Skill leírása is magyar legyen. Ne használj valódi személyes vagy API-adatot.

**Step 3: Capture screenshots in the documented sequence**

Böngésző-automatizálással vagy a Hermes böngésző eszközeivel járd be a hat fenti képernyőkép-követelményt. Minden képnél ellenőrizd, hogy az alkalmazás navigációs elemei magyarok, és a képen látszó demóbeszélgetés is a magyar útmutatóban leírt választ demonstrálja. A modellek kimenete nem determinisztikus: ha a válasz nem bizonyítja a dokumentum adott lépését, tiszta demóbeszélgetésben ismételd meg a kérést; ne retusáld és ne hamisítsd a képet.

**Step 4: Image quality pass**

Minden PNG-n:
- a fontos vezérlő, munkatérnév és fájlnév teljesen látszik;
- nincs kínai felületi címke, angol `Type a message…` helyőrző vagy más régi UI-szöveg;
- nincs token, helyi abszolút útvonal vagy személyes beszélgetés;
- a szöveg 100%-os nagyítás mellett olvasható;
- azonos böngészőméret és hasonló képkivágás szolgálja az útmutató egységességét.

**Step 5: Run focused test**

Run:

```bash
npx vitest run apps/inno-agent/test/hungarian-use-case-docs.test.ts
```

Expected: PASS.

**Step 6: Commit proposal**

```bash
git add docs/use-cases/assets/hu
git commit -m "docs: add Hungarian use-case screenshots"
```

---

### Task 4: Magyar dokumentációs belépési pontok frissítése

**Objective:** A magyar olvasók a magyar README-kből a magyar útmutatóra jussanak.

**Files:**
- Modify: `README.md:88-95`
- Modify: `README.hu.md:88-95`
- Do not modify: `README.en.md`

**Step 1: Update the link target and label**

Mindkét magyar README táblázatában a link célja legyen `./docs/use-cases/skill-tutorial.hu.md`, a cím pedig magyar, például:

```markdown
| [Skill útmutató – munkatérhez kötött tanulási ügynök építése](./docs/use-cases/skill-tutorial.hu.md) | Az `agent.md` és a `.skills/` használatával… |
```

**Step 2: Verify local links**

Ellenőrizd, hogy a README-link és a magyar útmutató mind a hat relatív képútvonala létező fájlra oldódik fel.

**Step 3: Commit proposal**

```bash
git add README.md README.hu.md
git commit -m "docs: link Hungarian README to localized tutorial"
```

---

### Task 5: Teljes validáció és kézi kiadási ellenőrzés

**Objective:** Biztosítani, hogy a dokumentáció működik, a képek valóban magyar futó alkalmazást mutatnak, és a meglévő alkalmazásbuild nem sérül.

**Files:**
- Verify: `apps/inno-agent/test/hungarian-use-case-docs.test.ts`
- Verify: `docs/use-cases/skill-tutorial.hu.md`
- Verify: `docs/use-cases/assets/hu/*.png`
- Verify: `README.md`, `README.hu.md`

**Step 1: Run all tests**

```bash
npx vitest run apps/inno-agent/test
```

Expected: minden teszt zöld, beleértve a dokumentációs szerződés-tesztet is.

**Step 2: Build the product**

```bash
npm run build
```

Expected: sikeres TypeScript- és Vite-build. A meglévő nagy chunkokra vonatkozó Vite-figyelmeztetések nem regressziók, ha a build sikeres.

**Step 3: Validate the real first-run Hungarian UI**

A buildelt, újraindított alkalmazásban ismét töröld a locale-kulcsokat, töltsd újra, és ellenőrizd a `document.documentElement.lang === "hu"` értéket, valamint legalább a kezdőképernyő, az Előnézet és a Készségek panel magyar címkéit.

**Step 4: Review rendered Markdown**

Nyisd meg a `skill-tutorial.hu.md` előnézetét (GitHub vagy helyi Markdown-renderelő), kattints végig mind a hat képen, és hasonlítsd a képet az előtte álló instrukcióhoz. A képen látható gombnevek és a leírt magyar megnevezések egyezzenek.

**Step 5: Final change audit**

```bash
git diff --check
git status --short
git diff --stat
```

Ellenőrizd, hogy csak a tervezett magyar útmutató, képek, dokumentációs teszt és magyar README-linkek szerepelnek a változtatásban. A korábban meglévő, nem kapcsolódó lokalizációs módosításokat külön kell tartani.

**Step 6: Final commit proposal**

```bash
git add apps/inno-agent/test/hungarian-use-case-docs.test.ts \
  docs/use-cases/skill-tutorial.hu.md docs/use-cases/assets/hu \
  README.md README.hu.md
git commit -m "docs: publish Hungarian use-case guide"
```

---

## Elfogadási kritériumok

- Létezik teljes magyar útmutató a `docs/use-cases/skill-tutorial.hu.md` útvonalon.
- A magyar útmutató hat magyar PNG-re hivatkozik a `docs/use-cases/assets/hu/` alatt.
- Minden képernyőkép a ténylegesen futó, magyar nyelvű Inno Agent felületéről készült.
- A `README.md` és a `README.hu.md` a magyar útmutatóra mutat.
- A régi kínai útmutató és annak képei érintetlenek.
- A dokumentációs teszt, a teljes Vitest-szett és a `npm run build` sikeres.
- A munkafa nem tartalmaz véletlenül hozzáadott runtime-adatot, titkot vagy privát beszélgetésképet.
