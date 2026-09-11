# bbbbb

[English](README.md) | [简体中文](README.zh-CN.md) | [Español](README.es.md) | [日本語](README.ja.md) | [Deutsch](README.de.md) | [Français](README.fr.md) | [Português (Brasil)](README.pt-BR.md)

<p align="center"><img src="assets/readme/bbbbb-logo.svg" width="128" alt="bbbbb"></p>

**Ein Hinweis, wenn du handeln musst.**

bbbbb („B-five“) sammelt Build-Ergebnisse, Fragen von Coding-Agenten und Deployment-Freigaben in deinem privaten Posteingang auf dem iPhone. Auch nach einer verpassten Mitteilung kannst du die Updates in der App ansehen.

Unter Handlungsbedarf bleiben Fragen, Fehler, Freigaben und Aufgaben bis zur Erledigung. Alles andere erscheint unter Aktivitäten. Quellen können nur senden, weder den Posteingang lesen noch Befehle ausführen.

<p align="center"><a href="https://apps.apple.com/us/app/bbbbb-coding-agent-alerts/id6791204016"><img src="assets/readme/download-on-the-app-store.svg" height="60" alt="App Store"></a></p>

[bbbbb.app](https://bbbbb.app/?lang=de)

## Demnächst: v1.5

Die App wird auf Englisch, vereinfachtem Chinesisch, Spanisch, Japanisch, Deutsch, Französisch und brasilianischem Portugiesisch verfügbar sein. Auch das Speichern des Verlaufs und der CSV-Export werden verbessert. Die Website ist bereits in sieben Sprachen verfügbar. Das App-Update ist noch nicht im App Store erschienen.

## Schnellstart

Gib deinem Coding-Agenten die Anweisung `Set up bbbbb at bbbbb.app/setup`. Er bereitet eine HTTP-Quelle vor. Scanne den temporären QR-Code oder gib den sechsstelligen Code auf dem iPhone ein und bestätige die Verbindung. Der Agent speichert den privaten Link und sendet eine Testnachricht. Für Apps und Automatisierungen verwende „App oder Automatisierung verbinden“ auf dem iPhone.

Nach der Einrichtung kannst du direkt über die gespeicherte Variable `BBBBB_SOURCE_URL` senden. Der Sender wählt die Kategorie: Handlungsbedarf, wenn eine Antwort nötig ist, sonst Aktivitäten. Quellen-URLs gehören nicht in Prompts oder Logs.

```sh
curl -X POST "$BBBBB_SOURCE_URL"
```

### Optionale CLI

```sh
npm install --global @bbbbbapp/cli
bbbbb setup --name "My Mac"
bbbbb run -- npm test
```

Wenn npm nicht verfügbar ist, nutze ein geprüftes [GitHub Release](https://github.com/xxsang/bbbbb/releases). Mehr dazu in der [CLI-Anleitung](https://bbbbb.app/docs/cli-source/?lang=de).

### Skill für Coding-Agenten

```sh
sh scripts/install-bbbbb-notify-skill.sh
```

Nach der Installation kannst du dem Agenten diese Anweisung geben:

> Verwende bbbbb für diese Aufgabe. Benachrichtige mich nach Abschluss. Sende Attention nur, wenn ich handeln muss. Keine Zwischenmeldungen.

## Anleitungen

[macOS](https://bbbbb.app/docs/macos/?lang=de) · [Linux](https://bbbbb.app/docs/linux/?lang=de) · [Windows](https://bbbbb.app/docs/windows/?lang=de) · [HTTP](https://bbbbb.app/docs/http-source/?lang=de) · [CLI](https://bbbbb.app/docs/cli-source/?lang=de)

## Tarife und Limits

Der kostenlose Tarif enthält alle Kernfunktionen: 1.000 Updates innerhalb der jeweils letzten 30 Tage und verschlüsselte Aufbewahrung der neuesten 100 für bis zu sieben Tage zum Nachladen nach einer Offlinephase.

Plus kostet in den ersten 60 Tagen nach Veröffentlichung einmalig 4,99 US-Dollar, einschließlich künftiger Funktionen. Es ist kein Abo. Ab dem 26. Oktober 2026 beträgt der reguläre Einmalpreis 6,99 US-Dollar. Den aktuellen lokalen Preis zeigt der App Store.

Plus erhöht das Kontingent auf 10.000 Updates, speichert die neuesten 500 für bis zu 30 Tage und ermöglicht JSON- und CSV-Export auf dem Gerät. Der kostenlose Tarif bleibt verfügbar.

Es gibt kein Tageskontingent. Alle Quellen eines Posteingangs teilen sich ein Sicherheitslimit von 20 Sendungen pro Minute. Zusätzliche Quellen erhöhen das Kontingent nicht.

## Datenschutz

CLI-Ereignisse werden vor dem Senden verschlüsselt, HTTP-Ereignisse vor dem Speichern. Quellen können den Verlauf nicht lesen. Mitteilungen zeigen keine Nachrichtendetails. Inhalte der Absender bleiben unverändert und werden nicht übersetzt.

Die Kernkomponenten für Entwickler stehen unter der [Apache License 2.0](LICENSE). Die iPhone-App ist separat.

<sub>Apple, das Apple-Logo und App Store sind Marken von Apple Inc., eingetragen in den USA und weiteren Ländern und Regionen.</sub>
