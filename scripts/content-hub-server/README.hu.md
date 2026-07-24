# Content Hub — helyi erőforrás-kiszolgáló: konfiguráció és használat

[中文](README.md) | [Magyar](README.hu.md)

Egy **függőségmentes**, helyi tartalomszolgáltatás, amely lehetővé teszi, hogy az inno-agent a **Skill-könyvtárat** és a **munkaterület-sablonokat (preseteket)** a saját gépedről — ne az alapértelmezett nyilvános GitHub-tárolóból — töltse le. Privát telepítéshez, offline használathoz vagy saját tartalomkészlet fenntartásához ajánlott.

- Szolgáltatásszkript: `scripts/content-hub-server/server.mjs` (Node ≥ 20, kizárólag beépített modulok + rendszer `tar`)
- Mellékelt példa: `scripts/content-hub-server/content-example/` (azonnal futtatható)

---

## Áttekintés egy ábrán

```
Saját tartalomkönyvtár                 Helyi szolgáltatás (:8787)          inno-agent backend (:3000)
content/                              server.mjs                           contentHub.type = "bundle"
├── skill-library/<id>/SKILL.md       ──beolvasás──►  GET /index.json   ◄──  baseUrl = http://localhost:8787
└── workspace-templates/<id>/         ──csomagolás──► GET /…/<id>.tar.gz ◄── Egyszerű mód presetkártyái / Skill-könyvtár
    ├── preset.json
    ├── agent.md
    └── .skills/
```

---

## Beállítás három lépésben

### ① A helyi szolgáltatás indítása

```bash
cd <projekt-gyökérkönyvtár>

# Először futtasd a mellékelt példával (első alkalomra ajánlott)
CONTENT_DIR=scripts/content-hub-server/content-example PORT=8787 \
  node scripts/content-hub-server/server.mjs
```

A szolgáltatás elindult, ha ezt a két sort látod:

```
[hub] … serving …/content-example
[hub] … listening on http://localhost:8787
```

Környezeti változók:

| Változó | Alapértelmezés | Leírás |
|---|---|---|
| `CONTENT_DIR` | `./content` | Tartalomkönyvtár (az indításkori munkakönyvtárhoz viszonyítva) |
| `PORT` | `8787` | Figyelési port |
| `HUB_TOKEN` | üres | Beállítása után `Authorization: Bearer ***` szükséges |

### ② Az inno-agent beállítása erre a forrásra

Szerkeszd a `runtime/config/config.json` fájlt, és módosítsd a `contentHub` értékét az alábbira:

```json
{
  "contentHub": {
    "type": "bundle",
    "baseUrl": "http://localhost:8787",
    "token": ""
  }
}
```

Mezők leírása:

| Mező | bundle mód | Leírás |
|---|---|---|
| `type` | `"bundle"` | Átváltás az önhosztolt szolgáltatásra (az alapértelmezett érték: `"github"`) |
| `baseUrl` | **kötelező** | A szolgáltatás címe, például `http://localhost:8787` |
| `token` | opcionális | Csak akkor töltsd ki, ha a szolgáltatáson be van állítva a `HUB_TOKEN`; az értékeknek egyezniük kell |

> Az `owner`/`repo`/`ref`/`skillsPath`/`presetsPath` a github mód mezői. A bundle mód figyelmen kívül hagyja őket, de megtarthatók, hogy bármikor vissza lehessen váltani.

Az alkalmazásban is megváltoztatható: **Beállítások → „Tartalomforrás” → „Önhosztolt szolgáltatás” kiválasztása**, majd töltsd ki a baseUrl/token értékeket.

### ③ A backend újraindítása az érvényesítéshez

> ⚠️ A `config.json` módosítása után **kötelező újraindítani a backendet** — a konfigurációt csak indításkor olvassa be.
> (Az alkalmazás „Tartalomforrás” panelén végzett módosítások azonnal érvényesek, újraindítás nélkül.)

```bash
bash restart-dev.sh restart --skip-build
```

Ellenőrizd, hogy a teljes lánc működik-e:

```bash
# Backend → helyi szolgáltatás: a presetteknek listázódniuk kell
curl -s localhost:3000/api/preset-library | python3 -m json.tool
# A Skilleknek listázódniuk kell
curl -s localhost:3000/api/skill-library  | python3 -m json.tool
```

Ezután nyisd meg az alkalmazást és kapcsold be az egyszerű módot; a kezdőoldalon megjelennek ezek a presetkártyák.

---

## A tartalomkönyvtár felépítése

A szolgáltatás a `CONTENT_DIR` alatt két rögzített alkönyvtárat olvas be:

```
content/
├── skill-library/
│   └── <skill-id>/
│       └── SKILL.md            # Kötelező. A frontmatter tetején lévő description kerül az indexbe
│       └── (egyéb fájlok/alkönyvtárak) # A Skill-lel együtt lesznek csomagolva és kiszolgálva
└── workspace-templates/
    └── <preset-id>/
        ├── preset.json         # Kötelező. { id, name, description, icon }
        ├── agent.md            # Munkaterületi kontextus (minden beszélgetéskor a rendszerpromptba kerül)
        └── .skills/            # Opcionális, munkaterület-specifikus Skillek
            └── <name>/SKILL.md
```

**Két szigorú szabály** (megsértésük esetén az adott elem csendben kimarad):

1. A `preset.json` fájlban lévő `id` értékének **egyeznie kell a könyvtár nevével**.
   - Példa: a `zhishidian/` könyvtárban a `preset.json` fájlnak ezt kell tartalmaznia: `"id": "zhishidian"`.
   - Meglévő sablon másolásakor gyakori hiba, hogy ez az érték kimarad a módosításból, ezért a kártya nem jelenik meg.
2. A Skill-könyvtárnak `SKILL.md`, a presetkönyvtárnak pedig `preset.json` fájlt kell tartalmaznia (ezek az azonosító jelölők).

Konvenciók:

- Az `id` kisbetűs, kötőjeles `kebab-case` formátumú legyen.
- A `_` vagy `.` karakterrel kezdődő könyvtárak (például `_template`) **nem** számítanak használható elemnek; ezek vázlatok vagy piszkozatok számára alkalmasak.

### A `preset.json` mezői

| Mező | Kötelező | Leírás |
|---|---|---|
| `id` | ✅ | Egyedi azonosító; kötelezően == a könyvtár neve |
| `name` | ✅ | Megjelenített név; a presetkártya címében látható |
| `description` | | Egymondatos leírás; a kártya alcímében jelenik meg |
| `icon` | | [lucide](https://lucide.dev/icons/) ikonnéve, például `presentation` / `book-open` / `lightbulb` |

---

## Saját tartalom használata

A példa csak bemutatási célokat szolgál. Valós tartalom kiszolgálásához a `CONTENT_DIR` változót irányítsd a saját könyvtáradra. A legpraktikusabb megoldás egy git-tároló munkapéldányára mutatni (a tároló kezeli a tartalmat, a szolgáltatás a csomagolást):

```bash
# Példa: az inno-agent-hub tároló klónozása és közvetlen használata tartalomforrásként
git clone git@github.com:Chloris-Blaxk/inno-agent-hub.git /path/to/hub
CONTENT_DIR=/path/to/hub node scripts/content-hub-server/server.mjs
```

> Maga ez a tároló is `skill-library/` + `workspace-templates/` elrendezésű, ezért közvetlenül használható.
> A szolgáltatás minden kéréskor valós időben építi újra az indexet és igény szerint hoz létre tarballt, így a `git pull` után **nem kell újraindítani**: a frissítés azonnal érvényesül.

Szerveres telepítésnél a `git pull` cronból vagy git webhookból futtatható, a szolgáltatás pedig folyamatosan kiszolgálja a legújabb tartalmat.

---

## Interfészszerződés (továbbfejlesztéshez)

Az inno-agent `BundleServiceSource` csak három írásvédett interfészre támaszkodik:

| Kérés | Válasz |
|---|---|
| `GET /index.json` | `{ "skills": [...], "presets": [...] }`; minden elem `id`/`name`/`description` mezőt tartalmaz, a presetek ezen felül `icon` mezőt is |
| `GET /skills/<id>.tar.gz` | A `skill-library/<id>/` gzip tar csomagja (a felső szintű `<id>/` könyvtárral; a kliens ezt `--strip-components=1` használatával eltávolítja) |
| `GET /presets/<id>.tar.gz` | A `workspace-templates/<id>/` gzip tar csomagja (ugyanígy) |
| `GET /health` | `{ ok, contentDir }` állapotellenőrzés |

`id` = könyvtárnév (útvonalhoz/letöltéshez), `name` = megjelenített név (preset esetén a `preset.json` fájlból).
Ha a `HUB_TOKEN` be van állítva, minden kérésnek tartalmaznia kell az `Authorization: Bearer ***` fejlécet, különben 401-es választ kap.

Ezt az interfészkészletet tetszőleges nyelven vagy keretrendszerrel megvalósíthatod e szolgáltatás helyett (például privát git-szolgáltatáshoz, objektumtárolóhoz stb. kapcsolódva).

---

## Visszaváltás a nyilvános GitHub-forrásra

A `config.json` fájlban állítsd vissza a `contentHub.type` értékét `"github"`-ra, majd indítsd újra a backendet.
A többi github mező (`owner`/`repo`/`ref`/...) megmarad. Figyelem: privát tárolóhoz vagy magasabb API-kvótához a `token` mezőbe GitHub PAT-et kell megadni.

---

## Hibaelhárítás

| Jelenség | Ok / megoldás |
|---|---|
| Egy sablon nem jelenik meg a presetkártyák között | Valószínűleg a `preset.json` `id` értéke ≠ a könyvtárnév, vagy a könyvtár neve `_`/`.` karakterrel kezdődik |
| Az `/api/preset-library` üres választ ad | A szolgáltatás nem fut / hibás a `baseUrl` / a backend nem lett újraindítva |
| A konfiguráció módosítása nem érvényesül | A backend csak indításkor olvassa a konfigurációt; futtasd a `restart-dev.sh restart --skip-build` parancsot (vagy módosítsd az alkalmazás paneljén) |
| 401 Unauthorized | A szolgáltatáson be van állítva a `HUB_TOKEN`, de a konfigurációban a `token` üres vagy eltérő |
| A letöltött tarball egy további könyvtárszintet tartalmaz | A kliens `tar --strip-components=1` használatával csomagol ki; kézi ellenőrzéskor is add meg ezt a paramétert |

Gyors önellenőrzés:

```bash
curl -s localhost:8787/health
curl -s localhost:8787/index.json | python3 -m json.tool
```
