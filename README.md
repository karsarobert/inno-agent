# Inno Agent

[Magyar](README.md) | [English](README.en.md)

> Nyílt forráskódú **személyes tanulási ügynök** rétegzett memóriarendszerrel, proaktív ütemezővel, többcsatornás üzenetküldéssel és munkaterülethez kötött Gyakorlólaborral — a [Pi coding-agent SDK](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) alapjain, **annak kerneljének módosítása nélkül**.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20.6.0-brightgreen.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-ESM-3178c6.svg)](https://www.typescriptlang.org/)
[![Website](https://img.shields.io/badge/Website-Inno%20Agent-ff6b35.svg)](https://hhyqhh.github.io/inno-agent-website/)

> 🌐 **Honlap:** [https://hhyqhh.github.io/inno-agent-website/](https://hhyqhh.github.io/inno-agent-website/) - projektáttekintés, funkcióbemutató és élő demók.

> 📄 **Műszaki jelentés:** [*Inno Agent: An Open-Source Personal Learning Agent with Layered Memory, Educational Post-Training, and Local Deployment*](./docs/inno-agent.pdf) (arXiv, 2026. június) — ismerteti a rendszertervet, a háromrétegű memóriaarchitektúrát, az oktatástervezési megalapozást, valamint a Qwen3.6 35B modellen végzett előzetes oktatási utótanítási eredményeket.
>
> 📦 **Erőforrásközpont:** [Chloris-Blaxk/inno-agent-hub](https://github.com/Chloris-Blaxk/inno-agent-hub) — az Inno Agent kiegészítő tárháza, amely a készségtárat, munkaterületi előbeállítás-sablonokat és a közösség által hozzájárult erőforrásokat tartalmazza.

<p align="center">
  <img src="./docs/assets/l2-wiki.png" alt="Inno Agent — L2 wiki tudásbázis és gráf" width="100%" />
</p>

Az Inno Agent egyetlen tanulót támogató társ, amely a hosszú távú tanulási támogatást három elkülönített memóriarétegbe szervezi — egy **L1 tanulói profilba**, egy **L2 natív wiki tudásbázisba**, valamint **L3 munkamenet-rekordokba beszélgetések közötti visszakereséssel** —, és mindezt egy tanulási ciklussal egészíti ki: cron ütemezővel, személyes IM-csatornákkal (Feishu / WeChat), továbbá böngészőbeli terminállal rendelkező Gyakorlólaborral.

Két formában érhető el, amelyek ugyanazt a `runtime/` és `workspace/` állapotot használják:

- **Terminálos CLI** (`inno`) — tisztán TUI-alapú ügynök, HTTP nélkül.
- **Webes felület** (React 19 + Lit + Tailwind 4) — Node HTTP-szerver támogatja SSE-streameléssel, terminálmunkamenetekkel, munkaterület-böngészővel, wiki gráffal, feladatokkal, készségekkel és beállításokkal.

---

## Miért az Inno Agent?

Az általános célú kódoló ügynököket nyílt végű, nagy kontextusigényű szoftverfejlesztésre optimalizálják, ami a legnagyobb modellek és a leghosszabb kontextusablakok irányába tereli őket. Az oktatás eltérő optimalizálási cél: a feladatok strukturáltabbak, az értéket pedig a **személyre szabott magyarázat, a tévképzetek diagnosztizálása, a feladatgenerálás, a visszajelzés, az ismétlés ütemezése, az adatvédelem és az alacsony késleltetésű, folyamatos interakció** jelenti.

Az Inno Agent más megközelítést alkalmaz:

- **Rétegzett memória, nem lapos beszélgetési összefoglaló.** A tanulói állapot, az archivált tudás és a közelmúltbeli párbeszéd életciklusa eltérő, ezért mindegyik külön rétegben kap helyet; a rendszerprompt és a tárolási elrendezés kifejezett határokat érvényesít.
- **A tartós tények eszközökbe kerülnek, nem válaszokba.** Minden, ami a jövőbeli tanítást befolyásolja, eszközökön keresztül íródik L1/L2-be, így a személyre szabási döntések bizonyítékokon alapulnak és nyomon követhetők.
- **Nyílt, javítható tanulói modell.** Az L1 profil a tanuló által megtekinthető és szerkeszthető; a rendszerprompt tiltja a bizonyíték nélküli címkéket.
- **Az SDK kernelje soha nem módosul.** Minden tanulási viselkedés regisztrált eszközökön és egyetlen kiterjesztési horgon (`createInnoExtension`) keresztül adódik hozzá, így az ügynök futtatókörnyezete kompatibilis marad az upstreammel.

---

## Funkciók

- 🧠 **Háromrétegű memória**
  - **L1 — Tanulói profil**: célok, tudásállapotok, tévképzetek és preferenciák; strukturált tanulási eseményekből frissül, majd minden kör előtt rövid, befecskendezett kontextuscsomaggá lesz összefoglalva.
  - **L2 — Natív wiki**: ember által olvasható, ügynök által lekérdezhető oldalak (források, fogalmak, entitások, elemzések), LLM-támogatott összegzéssel, entitás-/fogalom-összekapcsolással, valamint PDF/Office/kép betöltésével.
  - **L3 — Munkamenet-rekordok + beszélgetések közötti visszakeresés**: Pi-SDK munkamenetelőzmény, SQLite-ba indexelve küszöbérték-vezérelt lexikai felidézéssel, hogy a releváns korábbi beszélgetések munkamenetek között is előhívhatók legyenek.
- ⏰ **Proaktív ütemező** — cron által vezérelt, természetes nyelven létrehozott háttérfeladatok; az ügynökből, a felületből vagy a cron démonból futtathatók.
- 💬 **Személyes IM-csatornák** — Feishu (natív) és WeChat (bridge módban), egységes diszpécserrel, amely visszaküldi az emlékeztetőket.
- 🧪 **Gyakorlólabor** — munkaterülethez kötött webes terminál (xterm.js WebSocketen keresztül), az ügynök által olvasható futtatási rekordokkal.
- 🔌 **Csatlakoztatható szolgáltatók** — bármely `openai-completions` vagy `anthropic-messages` végpont (Anthropic, OpenAI, DeepSeek, Ollama vagy helyi modell); a modellek élőben válthatók a felületen.
- 🖥️ **CLI és webes felület** — azonos futtatókörnyezet, azonos memória, azonos készségek.
- 🛡️ **Opcionális operációsrendszer-szintű sandbox** — az ügynök bash- és fájlműveleteinek korlátozása a [pi-sandbox](https://github.com/carderne/pi-sandbox) segítségével.

---

## Követelmények

- **Node.js >= 20.6.0** (a beszélgetések közötti L3-visszakeresés a beépített `node:sqlite` modult használja, amely Node 22.5+-tól érhető el; régebbi futtatókörnyezeteken az L3 felidézés fokozatosan korlátozott, az ügynök többi része azonban rendesen fut).
- **npm** (munkaterületeket használ; nincs szükség további csomagkezelőre).

---

## Gyors kezdés

Most ismerkedik vele? Kezdje a **[QUICKSTART.md](./QUICKSTART.md)** dokumentummal (5 perc). Röviden:

```bash
git clone https://github.com/hhyqhh/inno-agent.git
cd inno-agent

npm install      # pulls the Pi SDK from npm
npm run build    # compiles backend + web

mkdir -p runtime/config runtime/data runtime/skills workspace
cp config.example.json runtime/config/config.json
# Edit runtime/config/config.json and set providers[*].apiKey

npm run server -- --home ./runtime --workspace ./workspace --port 3000
```

Nyissa meg a **http://localhost:3000** címet.

---

## Felhasználási esetek

A valós használati útmutatók a [`docs/use-cases/`](https://github.com/hhyqhh/inno-agent/tree/main/docs/use-cases) könyvtárban találhatók.

| Útmutató | Leírás |
|---|---|
| [Skill Tutorial — Building a Workspace Agent](./docs/use-cases/skill-tutorial.md) | Az `agent.md` és a `.skills/` használatával egy munkaterülethez kötött egyéni tanulási ügynök építése, konkrét angolnyelv-tanulási példával |

---

## Futtatási módok

**Webes felület** (kiszolgálja az API-t és a lefordított frontendet):

```bash
npm run server -- --home ./runtime --workspace ./workspace --port 3000
```

**CLI** (terminálos ügynök, HTTP nélkül):

```bash
npm run start -- --home ./runtime --workspace ./workspace
```

**Fejlesztői mód** (backend + Vite HMR a :5173 porton, az `/api` kérések a :3000 portra proxyzva):

```bash
npm run dev:server     # backend
npm run web:dev        # frontend
```

**Sandbox** (a bash-/fájlműveletek operációsrendszer-szintű izolációja; `ripgrep` szükséges):

```bash
npm run server:sandbox -- --home ./runtime --workspace ./workspace --port 3000
```

A mellékelt `restart-dev.sh` mindkét folyamatot vezényli (build, indítás, leállítás, állapot, naplók, smoke-teszt). Futtassa: `bash restart-dev.sh --help`.

---

## Konfiguráció

`runtime/config/config.json` (sablon: [`config.example.json`](./config.example.json)):

```json
{
  "defaultProvider": "innospark",
  "defaultModel": "claude-sonnet-4-6",
  "providers": {
    "innospark": {
      "baseUrl": "https://api.example.com",
      "api": "anthropic-messages",
      "apiKey": "replace-me",
      "models": [{ "id": "claude-sonnet-4-6", "name": "Claude Sonnet 4.6" }]
    }
  },
  "server": { "port": 3000 },
  "channels": {
    "feishu": { "enabled": false },
    "wechat": { "enabled": false, "mode": "bridge", "sidecarBaseUrl": "http://127.0.0.1:4319" }
  }
}
```

Minden szolgáltató rendelkezik `baseUrl`, `api` (`openai-completions` vagy `anthropic-messages`), `apiKey` és `models[]` mezővel. A szerver automatikusan átírja ezt a fájlt, amikor a felületen modellt vált.

### Futtatókörnyezeti útvonalak feloldása

Mind a CLI, mind a szerver az `apps/inno-agent/src/runtime.ts` segítségével oldja fel az útvonalakat. Elsőbbségi sorrend: **CLI jelző > környezeti változó > `~/.inno-agent/...`**.

| CLI jelző                          | Környezeti változó                | Alapértelmezett                   |
| --------------------------------- | ---------------------- | ------------------------- |
| `--home`                          | `INNO_HOME`            | `~/.inno-agent`           |
| `--config`                        | `INNO_CONFIG_FILE`     | `<configDir>/config.json` |
| `--config-dir`                    | `INNO_CONFIG_DIR`      | `<home>/config`           |
| `--data` / `--data-dir`           | `INNO_DATA_DIR`        | `<home>/data`             |
| `--skills` / `--skills-dir`       | `INNO_SKILLS_DIR`      | `<home>/skills`           |
| `--workspace` / `--workspace-dir` | `INNO_WORKSPACE_DIR`   | meghívási CWD             |
| `--port`                          | `INNO_PORT` (`config`) | `3000`                    |

### Content Hub (készségtár + munkaterületi előbeállítások)

A globális **készségtárat** és az Egyszerű mód **munkaterületi előbeállításait** (egy `agent.md` + `.skills/` csomagot, amely egykattintásos kártyaként jelenik meg az üdvözlőképernyőn) egy távoli **content hub** szolgálja ki. Alapértelmezésben ez a nyilvános [`Chloris-Blaxk/inno-agent-hub`](https://github.com/Chloris-Blaxk/inno-agent-hub) GitHub-tárház; helyette beállíthat privát GitHub-tárház vagy saját üzemeltetésű csomagszolgáltatás is — csak konfigurációs módosítás szükséges, kódmódosítás nem.

Konfigurálja a `runtime/config/config.json` fájlban (vagy a felületen: **Beállítások → Content Hub**):

```jsonc
// Default: pull from a GitHub repo
{
  "contentHub": {
    "type": "github",
    "owner": "Chloris-Blaxk",
    "repo": "inno-agent-hub",
    "ref": "main",
    "skillsPath": "skill-library",        // dir holding <skill>/SKILL.md
    "presetsPath": "workspace-templates",  // dir holding <preset>/preset.json
    "token": ""                            // optional PAT: private repos / higher rate limit
  }
}
```

```jsonc
// Or: pull from a self-hosted bundle service (private deployments)
{
  "contentHub": {
    "type": "bundle",
    "baseUrl": "http://localhost:8787",
    "token": ""                            // optional Bearer credential
  }
}
```

Az előbeállítások első használatkor töltődnek le, majd a `<dataDir>/preset-cache/` alatt gyorsítótárba kerülnek; az alkalmazásba csomagolt sablonok offline tartalékként szolgálnak. Egy örökölt `github.token` automatikusan `contentHub.token` értékké migrálódik.

**Saját üzemeltetés:** a nulla függőségű helyi csomagszolgáltatás a [`scripts/content-hub-server/`](./scripts/content-hub-server/) könyvtárban található — használja a készségek és sablonok privát git-tárházával. Az elrendezésről és a futtatási parancsokról lásd a [README](./scripts/content-hub-server/README.md) dokumentumát:

```bash
CONTENT_DIR=/path/to/content node scripts/content-hub-server/server.mjs
```

---

## Tárházstruktúra

```text
apps/inno-agent/          Backend (CLI + HTTP server), TypeScript -> dist/
apps/inno-agent/web/      Frontend (React 19 + Lit + Tailwind 4 + Vite)
scripts/content-hub-server/  Self-hosted Content Hub bundle service (skills + presets)
runtime/                  Local runtime state (config, data, skills) - gitignored
workspace/                Default agent working directory - gitignored
```

A Pi SDK csomagok (`@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-web-ui`) npm-ből töltődnek le.

---

## Architektúra

Az Inno Agent egyetlen felhasználóra tervezett rendszer, amely négy rétegből áll: **felhasználói felületek → alkalmazási réteg → Pi ügynök-futtatókörnyezet → rétegzett memória.**

```text
User Interfaces      CLI · Web UI (React) · Feishu · WeChat
        ↓
Application Layer    Channel adapters · HTTP API (SSE) · Memory orchestration
                     Cron scheduler · Practice Lab · WebSocket terminal
        ↓
Agent Runtime        Pi AgentSession · registered tools · inno extension
(Pi SDK, unmodified) General LLM provider  ──or──  distilled educational model
        ↓
Layered Memory       L1 learner profile · L2 native wiki · L3 session records
```

- **Ügynökmag** — az `@earendil-works/pi-coding-agent` biztosítja a ciklust. Az Inno ezt az `apps/inno-agent/src/agent/inno-extension.ts` burkolóval egészíti ki, amely regisztrálja a szolgáltatókat és az eszközöket (L1 tanuló, L2 wiki, L3 felidézés, ütemező, gyakorlólabor), valamint egy `before_agent_start` horgot, amely az L1 kontextuscsomagot — és szükség esetén a küszöbérték-vezérelt L3-felidézést — a rendszerpromptba fecskendezi.
- **L1 — tanulói memória** (`src/memory/learner/`): bizonyítékokra épülő profil + eseménynapló, körönként `ContextPack` formájában összefoglalva.
- **L2 — wiki memória** (`src/memory/l2/`): frontmatterrel, hivatkozásokkal, gráffal, összegzővel és dokumentumbetöltéssel rendelkező strukturált wikioldalak; ügynökeszközökként és az `/api/wiki/*` útvonalon is elérhető.
- **L3 — munkamenet-memória** (`src/memory/l3/` + Pi `SessionManager`): az SDK kezeli a munkamenet JSONL-fájljait; az Inno erre SQLite-indexet (`node:sqlite` + FTS5) épít a beszélgetések közötti felidézéshez, amely automatikusan (egy relevanciaküszöb felett) és az `l3_recall` eszközön keresztül is elérhető.
- **Ütemező** (`src/scheduler/`): cron feladatok `jobs.json` + `runs.jsonl` fájlokban perzisztálva; az ügynökből (`run_scheduled_job`), a felületről vagy a démonból futtathatók.
- **Csatornák** (`src/channels/`): `ChannelRegistry` Feishuval (és bridge módú WeChattel), hogy az emlékeztetők visszaküldhetők legyenek.
- **HTTP-szerver** (`src/server.ts`): egyszerű Node `http.createServer`, SSE-vel a chat streameléséhez és WebSockettel a böngészőbeli terminálhoz.
- **Webes felület** (`web/src/`): React 19 + Lit + Tailwind 4. Az állapotot a keretrendszertől független `EventEmitter` tárolók kezelik a `web/src/stores/` alatt; a REST/SSE-hívások a `web/src/api/` alatt találhatók.

A backend API-útvonalak táblázata és a futtatókörnyezet részletei az [`apps/inno-agent/README.md`](./apps/inno-agent/README.md) dokumentumban találhatók.

---

## Telepítés

Egy tipikus éles elrendezés elkülöníti a kódot, a konfigurációt, az adatokat és a munkaterületet:

```text
/opt/inno-agent              # this repository
/etc/inno-agent/config.json  # config
/var/lib/inno-agent/data     # sessions, jobs, memory, downloads
/var/lib/inno-agent/skills   # uploaded skills
/srv/inno-workspace          # files the agent should work on
```

```bash
INNO_CONFIG_DIR=/etc/inno-agent \
INNO_DATA_DIR=/var/lib/inno-agent/data \
INNO_SKILLS_DIR=/var/lib/inno-agent/skills \
INNO_WORKSPACE_DIR=/srv/inno-workspace \
INNO_PORT=3000 \
npm run server
```

Kiindulópontként rendelkezésre áll egy [`Dockerfile`](./Dockerfile) és egy [`docker-compose.yml`](./docker-compose.yml).

---

## Közreműködés

A hibajelentéseket és PR-eket örömmel fogadjuk. PR megnyitása előtt futtassa helyben a `npm run build` parancsot — még nincs felső szintű lint- vagy tesztfuttató konfigurálva, de a TypeScript build egyben épségellenőrzés is. A változtatások maradjanak célzottak, kövessék a meglévő kódstílust, és a viselkedés változásakor frissítsék a vonatkozó dokumentációt.

---

## Közösség

Csatlakozzon a WeChat felhasználói csoporthoz kérdésekhez, használati esetek megosztásához és a frissítések követéséhez. Olvassa be az alábbi QR-kódot:

<p align="center">
  <img src="./docs/assets/wechat-community-qr.png" alt="Az Inno Agent WeChat közösségi csoportjának QR-kódja" width="240" />
</p>

---

## Licenc

[MIT](./LICENSE).

Ez a projekt a Pi SDK-ra (Mario Zechner `@earendil-works/pi-*` csomagjaira) épül, amely szintén MIT-licencű és npm-en keresztül kerül felhasználásra.

---

## Hivatkozás

Ha kutatásában használja az Inno Agentet, kérjük, hivatkozza az alábbiak szerint:

```bibtex
@misc{hao2026innoagent,
  author       = {Hao Hao, Ye Lu, Ruotong Yang, Yongheng Guo and Aimin Zhou},
  title        = {Inno Agent: An Open-Source Personal Learning Agent with Layered Memory, Educational Post-Training, and Local Deployment},
  year         = {2026},
  publisher    = {GitHub},
  journal      = {GitHub repository},
  howpublished = {\url{https://github.com/hhyqhh/inno-agent}},
  note         = {Accessed: 2026-07-17}
}
```
