# AutoSubs – crew10-Version

Eigene Version von [AutoSubs](https://github.com/tmoroney/auto-subs) (MIT-Lizenz) mit Erweiterungen für unsere Kundenproduktionen. Branch: `crew10`.

## Installieren

1. [AutoSubs-crew10-Mac-ARM.pkg](https://github.com/Kloeckner-crew10/auto-subs/releases/latest/download/AutoSubs-crew10-Mac-ARM.pkg) laden (Mac mit Apple Silicon).
2. Doppelklick. Blockiert macOS die Datei: **Systemeinstellungen → Datenschutz & Sicherheit → ganz unten „Dennoch öffnen“**, bestätigen, Installer durchklicken. (Alternativ im Terminal: `xattr -d com.apple.quarantine ~/Downloads/AutoSubs-crew10-Mac-ARM.pkg`, dann Doppelklick.)
3. In DaVinci Resolve **Workspace → Scripts → AutoSubs** starten.

Eine vorhandene Original-AutoSubs-Installation wird ersetzt; Einstellungen und Transkripte bleiben. Updates kommen automatisch aus diesem Repository (eigener Signaturschlüssel, nicht der von tmoroney).

## Neue Version veröffentlichen

Version erhöhen (`npm run bump-version -- 3.11.2` in `AutoSubs-App`), dann `AutoSubs-App/scripts/release-crew10.sh` ausführen. Das Skript baut App und Installer, signiert das Update mit dem Schlüssel `~/.tauri/crew10-autosubs.key` und lädt alles als GitHub-Release hoch. **Den Schlüssel sichern:** ohne ihn können installierte Apps keine Updates mehr annehmen.

## Was neu ist

### Kundenprofile (Zeile „Kunde“)
Pro Kunde ein Profil mit:
- **Hervorgehobene Begriffe** (Spieler, Vereine, Marken): werden immer komplett in der Profilfarbe dargestellt, auf der Resolve-Untertitelspur und in den Fusion-Untertiteln. Namen aus mehreren Wörtern („Bayern München“) werden nie auf zwei Zeilen oder Untertitel verteilt.
- **Schreibweisen**: `falsch => richtig`, z. B. `Balak => Ballack`; `ähm =>` entfernt Füllwörter.
- **Timing**: Mindest- und Maximaldauer, Pause bis zum neuen Untertitel.
- **Untertitel-Stil**: optional ein Fusion-Preset.

Mitgeliefert: Profil **Tipico** (Rot `#C8102E`, Bundesliga- und Top-Europa-Vereine, erste Spieler, Schreibweisen). Die Liste im Profil-Dialog erweitern.

### Double Proof (Zeile „Double Proof“)
Ein zweites lokales Modell hört die Tonspur noch einmal ab und vergleicht Wort für Wort. Timing und Sprecher bleiben von Modell 1.
- **Sicherere gewinnt**: das Modell mit der höheren Wort-Sicherheit gewinnt (Parakeet liefert keine Sicherheit, dann wird nur gemeldet).
- **Modell 2 gewinnt**: Abweichungen werden direkt übernommen.
- **Nur melden**: nichts wird geändert; jede Abweichung erscheint als **Vorschlag** unter dem Untertitel (Übernehmen / ✕).

Empfehlung: Modell 2 = Whisper Large v3 Turbo (nicht „tiny“).

### Senden an Resolve
- **Ausgabe als**: Video-Spur (Fusion-Untertitel), Untertitelspur (nur Text) oder beides.
  Die Untertitelspur übernimmt Schrift, Größe, Position und Schatten der vorhandenen Spur – Stil einmal in Resolve auf der Spur einstellen.
- **Plattform / Safe Zone**: Reels/Story, TikTok, Shorts, YouTube 16:9, Feed 1:1 und 4:5. Zeigt die empfohlene Untertitel-Position und legt auf Wunsch ein Safe-Zone-Raster als Hilfsebene „AutoSubs Safe Zone“ auf die Timeline. **Vor dem Export „Raster entfernen“.**

## Bauen und starten (macOS, Apple Silicon)

Voraussetzungen: Xcode Command Line Tools, Homebrew, Node.js.

```bash
brew install rustup cmake luajit
rustup default stable
cd AutoSubs-App
npm install
mkdir -p src-tauri/binaries
cp /Applications/AutoSubs.app/Contents/MacOS/ffmpeg src-tauri/binaries/ffmpeg-aarch64-apple-darwin   # ffmpeg aus der offiziellen App
npm run setup-resolve   # legt "AutoSubs (Dev)" in Resolve an
```

Falls die Command Line Tools ein macOS-SDK mitbringen, das ihr eigener Linker nicht lesen kann (Fehler `tapi error: malformed file … unknown architecture arm64e.x1`), mit einem älteren SDK bauen und den Linker-Wrapper `AutoSubs-App/scripts/cc-sdk265.sh` verwenden:

```bash
export PATH=/opt/homebrew/opt/rustup/bin:$PATH
export SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk
export CARGO_TARGET_AARCH64_APPLE_DARWIN_LINKER="$PWD/scripts/cc-sdk265.sh"
npm run dev:mac:arm64
```

In Resolve dann **Workspace → Scripts → AutoSubs (Dev)** starten.

## Noch offen
- Die Fusion-Untertitelvorlage (`Resolve-Integration/autosubs-macro.setting`) enthält die Stichwort-Färbung, die mitgelieferte `caption-bin.drb` ist aber noch nicht neu erzeugt. Das geht nur in Resolve: `npm run setup-resolve`, dann **Workspace → Scripts → AutoSubs - Update Caption Template** (siehe `Resolve-Integration/docs/maintainer-template-release.md`). Bestehende Projekte behalten die alte Vorlage, bis der Clip „AutoSubs Caption“ aus dem Media Pool gelöscht wird.
- Safe-Zone-Werte sind Richtwerte aus den Plattform-Vorgaben.

## Code signing (macOS)

Builds are signed with the self-signed certificate "crew10 AutoSubs"
(SHA-1 3018C8A68B2A0B9DA64588C88FD442643D16BE7C, `bundle.macOS.signingIdentity`
in `tauri.conf.json`). A stable signature keeps the macOS Accessibility
permission, which AutoSubs needs to set the subtitle track look in Resolve,
across updates. The certificate and key live in the login keychain of the
build Mac; a backup is in `~/.tauri/crew10-codesign/` (never commit it).
