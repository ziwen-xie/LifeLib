# LifeLibrary

**[🌐 Explore the LifeLibrary website](https://ziwen-xie.github.io/LifeLib/)**

[![LifeLibrary — Your digital life, understood](https://ziwen-xie.github.io/LifeLib/og.png)](https://ziwen-xie.github.io/LifeLib/)

LifeLibrary is a local-first intelligent desktop file explorer. It keeps the familiar folder-and-file experience while adding AI summaries, persistent categories, semantic search, document previews, recent activity, and a visual map of relationships between files.

## Why it exists

Traditional file explorers assume people remember filenames and folder paths. LifeLibrary lets people search by meaning: a user can look for “the microscopy experiment with recovery curves” or browse a research category even when the original filename is vague.

## Current features

- Native Windows desktop experience built with Electron
- Real folder navigation, file previews, double-click open, rename, reveal, and recycle bin
- Automatic summaries, categories, subcategories, confidence, tags, and evidence
- Local LM Studio support or an optional OpenAI-compatible cloud provider
- PDF, DOCX, PPTX, text, JSON, CSV, and image-aware extraction
- Search across filenames, summaries, categories, tags, and evidence
- Dashboard for recently opened, edited, and created files
- Category explorer with adjustable top-level taxonomy size
- Zoomable file-universe view that reveals related documents
- Image thumbnails and document-specific AI visual cards
- Persistent analysis so previously categorized files do not fall back to Uncategorized
- Context-isolated Electron IPC and strict path-boundary checks

## Run from source

Requirements: Windows, Node.js 24+, and optionally LM Studio for local analysis.

```powershell
npm install
npm start
```

The development build initially uses a sibling `../Files` folder; the packaged app initially uses `Documents\LifeLibrary Files`. In either build, open **Settings → Explorer vault → Choose folder** to point LifeLibrary at any folder you want to browse and analyze.

### Local AI with LM Studio

1. Start LM Studio's local server.
2. Open LifeLibrary → Settings.
3. Select **Local LLM**.
4. Enter the endpoint and loaded model name.
5. Test the connection and save.

The current tested endpoint is `http://127.0.0.1:1234/v1`. Model names are configurable.

### OpenAI-compatible analysis

Choose **OpenAI API** in Settings, enter the API key locally, select a model, and save. The key is encrypted through Electron's `safeStorage` and is never written in plain text.

## Build the Windows installer

```powershell
npm run dist:win
```

The installer is produced at `dist\LifeLibrary-Setup-0.1.1.exe`. The installed app stores settings and AI indexes under the user's application-data directory instead of writing inside the installation folder.

## Testing and safety

```powershell
npm test
```

The test suite verifies scanning, categorization, taxonomy consolidation, and the filesystem boundary. File operations resolve and validate paths before opening, renaming, recycling, restoring, or deleting anything.

## How Codex and GPT-5.6 contributed

Codex accelerated product design, Electron implementation, filesystem safety reviews, test creation, packaging, and rapid iteration across the Explorer, Dashboard, Categories, Connections, Settings, preview, search, and recycle-bin experiences. The OpenAI provider path supports GPT-5.6-class analysis for structured summary and taxonomy output; the default local path keeps the same product usable with LM Studio.

## Roadmap

- User-selected library roots and multiple libraries
- Embedding-based semantic retrieval across large collections
- Duplicate and version detection
- Cross-device encrypted metadata sync
- Team knowledge spaces with permission-aware indexing
- Automatic filing suggestions with preview and undo
- Accessibility, localization, and macOS support

## Privacy

LifeLibrary is designed around local control. Local-model mode keeps document content on the user's machine. Cloud analysis is opt-in, and the app exposes which provider is active before analysis.
