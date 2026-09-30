# itSupport

Kunden, Zugänge und Fernwartung für den IT-Support, auf iPhone und Desktop.
Alle Kundendaten werden **im Browser verschlüsselt**, bevor sie das Gerät
verlassen. Der Server speichert nur Chiffretext.

- **Notfallsuche:** Kunde, Gerät, IP oder AnyDesk-ID eintippen, Treffer mit „Verbinden“ und „Kopieren“.
- **Fernwartungsliste:** alle AnyDesk- und TeamViewer-IDs aller Kunden auf einen Blick.
- **Kundenansicht:** Netzwerk, Server/NAS, Benutzer, Microsoft 365, Portale, Backup, Notizen.
- **Offline:** Die verschlüsselte Kopie liegt auf dem Gerät, Entsperren geht auch ohne Netz.
- **Zwei Personen:** Admin und Mitarbeiter, jeweils mit eigenem Master-Passwort. Änderungen werden abgeglichen.
- **Sicherheitscheck:** zeigt Passwörter, die bei mehreren Kunden vorkommen.
- **Automatische Sperre** nach Inaktivität und wenn die App länger im Hintergrund ist.
- **Bilder** pro Kunde (Screenshots, Fotos vom Router-Aufkleber …), verschlüsselt, auch offline verfügbar.
- **Verlauf:** Jede Änderung hebt den vorherigen Stand auf (bis zu 50 Versionen pro Kunde). Alte Werte ansehen,
  kopieren oder die ganze Version wiederherstellen. Gelöschte Kunden landen im **Papierkorb**.

## Sicherheitsmodell

```
Master-Passwort ──PBKDF2-SHA256, 600.000 Runden──► 512 Bit
   ├─ KEK      → entschlüsselt den Datenschlüssel   (verlässt das Gerät nie)
   └─ authKey  → Anmeldenachweis beim Server        (Server speichert nur SHA-256 davon)

Datenschlüssel (zufällig, 256 Bit) ──AES-256-GCM──► Kundendaten
```

- Jeder Benutzer hat seine eigene verschlüsselte Kopie des Datenschlüssels.
- Wer nur den Server oder die Datenbank hat, kann nichts lesen.
- Nach 10 Fehlversuchen wird ein Benutzername 15 Minuten gesperrt.
- **Das Master-Passwort kann niemand zurücksetzen.** Wenn es verloren geht, sind die Daten weg.
  Deshalb ab und zu unter *Einstellungen → Verschlüsselte Sicherung laden* eine Sicherung ziehen.
- Wird ein Mitarbeiter entfernt, kommt er nicht mehr an den Server. Die Kopie auf seinem Gerät
  kann er mit seinem alten Passwort aber weiter öffnen. Ändere dann die wichtigsten Kundenpasswörter.
- Kundendaten, Import-Dateien und die Zuordnungsdatei sind per `.gitignore` vom Repository ausgeschlossen.

## Einrichtung auf Vercel (einmalig, etwa 10 Minuten)

1. **Projekt anlegen:** Auf vercel.com *Add New → Project* wählen und dieses Repository importieren.
   Framework: *Other*. Build- und Output-Einstellungen bleiben leer.
2. **Datenbank verbinden:** Im Projekt unter *Storage* (Marketplace) **Upstash for Redis** anlegen
   (der kostenlose Plan reicht) und mit dem Projekt verbinden.
   Dabei werden `KV_REST_API_URL` und `KV_REST_API_TOKEN` automatisch gesetzt.
3. **Einrichtungs-Code setzen:** Unter *Settings → Environment Variables* die Variable
   `KZ_SETUP_TOKEN` mit einem zufälligen Wert von mindestens 16 Zeichen anlegen.
4. **Neu deployen:** *Deployments → Redeploy*, damit die Variablen greifen.
5. **Tresor anlegen:** Die Vercel-Adresse öffnen. Die App zeigt „Einrichtung“: Einrichtungs-Code eingeben,
   Benutzernamen wählen und ein langes Master-Passwort festlegen.
6. **Daten importieren:** *Einstellungen → Import / Sicherung einspielen* und die Datei
   `itsupport-import.json` wählen (siehe unten). Die Datei danach **löschen**.
7. **Mitarbeiter anlegen:** *Einstellungen → Benutzer*, mit Namen und Startpasswort.
   Das Startpasswort persönlich übergeben. Der Mitarbeiter ändert es nach der ersten Anmeldung.

Tipp: Eine eigene Domain wie `support.franchcom.at` lässt sich unter *Settings → Domains* verbinden.

## Auf dem iPhone installieren

1. Die Adresse in **Safari** öffnen.
2. Auf *Teilen* und dann *Zum Home-Bildschirm* tippen.
3. Die App startet dann im Vollbild wie eine normale App und funktioniert auch offline.

„Verbinden“ öffnet `anydesk:<ID>`. Auf Windows und macOS startet das AnyDesk direkt.
Falls die AnyDesk-App auf dem iPhone den Link nicht annimmt, die ID mit dem Kopieren-Button übernehmen.

## Bestandsdaten importieren

`tools/import_bestand.py` liest Excel- und Word-Dateien ein und schreibt eine Import-Datei.
Welche Datei, welches Blatt und welche Zeilen zu welchem Kunden gehören, steht in einer
Zuordnungsdatei. Den Aufbau zeigt `tools/zuordnung.beispiel.json`.

```bash
pip install -r tools/requirements.txt
python3 tools/import_bestand.py \
  --config tools/zuordnung.json \
  --quelle ~/Kundendaten \
  --ziel itsupport-import.json
```

Modi für Tabellenbereiche:

| Modus   | Verwendung |
|---------|------------|
| `cards` | Tabelle mit Kopfzeile; jede Zeile wird eine eigene Karte (z. B. ein Benutzer oder Gerät) |
| `rows`  | Tabelle mit Kopfzeile; jede Zeile wird ein Eintrag (z. B. ein Backup-Job) |
| `kv`    | zwei Spalten: Bezeichnung, Wert |
| `free`  | freie Notizen; „Bezeichnung: Wert“ wird erkannt |

Passwörter erkennt das Skript an der Spaltenüberschrift (PW, Passwort, Kennwort …) und an ihrer Form.
In der App lässt sich jeder Eintrag nachträglich auf „geheim“ stellen oder davon befreien.

Eingebettete Bilder aus Excel-Blättern und Word-Dokumenten übernimmt der Abschnitt `images` der
Zuordnung (mit Titel und Gruppe je Bild); dafür wird zusätzlich `Pillow` gebraucht.

## Entwicklung

```bash
npm run dev     # http://localhost:3000, Einrichtungs-Code: dev-setup-token-0000
npm test        # Verschlüsselung, Suche, Zusammenführen, komplette API
```

Es gibt keinen Build-Schritt und keine Abhängigkeiten. Das Frontend ist reines HTML/CSS/JS im Hauptordner
(`index.html`, `app.css`, `js/`, `icons/`), die API besteht aus Vercel-Funktionen in `api/`.
Was nicht veröffentlicht werden soll, steht in `.vercelignore`.

| Datei | Inhalt |
|-------|--------|
| `js/crypto.js` | Schlüsselableitung und Ver-/Entschlüsselung (WebCrypto) |
| `js/model.js`  | Datenmodell, Suche, Zusammenführen, Import |
| `js/vault.js`  | Sitzung, lokale Kopie, Abgleich mit dem Server |
| `js/app.js`    | Oberfläche |
| `js/blobstore.js`     | lokaler Speicher (IndexedDB) für verschlüsselte Bilder und Versionen, Upload-Warteschlange |
| `js/images.js`        | Bilder vor dem Verschlüsseln verkleinern |
| `api/*.js`            | `status`, `prelogin`, `setup`, `vault`, `users`, `password`, `blob` |
| `api/_lib/storage.js` | Upstash Redis (Produktion) bzw. JSON-Datei (lokal) |
