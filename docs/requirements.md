# Political Network Research Platform

## 1. Ziel

Implementiere eine Webanwendung zur strukturierten Recherche und Visualisierung von Verbindungen zwischen politischen Personen, Organisationen, Unternehmen, parlamentarischen Gremien, Veranstaltungen, Initiativen, Ländern und weiteren relevanten Entitäten.

Die Anwendung soll Informationen aus strukturierten und unstrukturierten öffentlichen Quellen sammeln, normalisieren, durch ein Sprachmodell analysieren und anschliessend durch einen menschlichen Review-Prozess verifizieren.

Veröffentlichte Beziehungen müssen jederzeit auf konkrete Quellen und Evidenz zurückgeführt werden können.

Supabase/PostgreSQL ist die zentrale Datenbank und Source of Truth.

Der öffentliche Netzwerkgraph darf ausschliesslich verifizierte Daten verwenden.

---

# 2. Kernprinzipien

Die Plattform muss folgende Prinzipien einhalten:

1. Eine Quelle erzeugt niemals automatisch eine öffentlich sichtbare Beziehung.
2. Ein Sprachmodell erzeugt ausschliesslich Beziehungskandidaten.
3. Jede Beziehung benötigt Evidenz.
4. Jede Evidenz muss auf eine konkrete Quelle zurückgeführt werden können.
5. Direkte, indirekte, amtliche und historische Beziehungen müssen unterschieden werden.
6. Gemeinsame Erwähnung bedeutet keine Beziehung.
7. Eventteilnahme bedeutet keine Mitgliedschaft.
8. Ein politisches Statement bedeutet keine Lobbyverbindung.
9. Ein amtliches Treffen bedeutet keine persönliche oder politische Nähe.
10. Historische Mandate dürfen nicht als aktuelle Mandate dargestellt werden.
11. Jede veröffentlichte Information muss korrigierbar und versionierbar sein.
12. Das System muss zwischen Fakten, Behauptungen und Schlussfolgerungen unterscheiden.

---

# 3. Technologie

## 3.1 Bestehende Infrastruktur

Verwende das vorhandene Supabase-Projekt.

Supabase/PostgreSQL soll verwendet werden für:

* Entities
* Aliases
* Sources
* Documents
* Events
* Claims
* Claim Evidence
* Entity Resolution
* Review Queue
* Crawl Runs
* Audit Log
* Benutzer und Rollen
* Graph Queries
* optional Embeddings

Keine zweite relationale Primärdatenbank einführen.

---

# 4. Architektur

Die Architektur soll logisch folgende Komponenten enthalten:

```text
Source Discovery
      |
      v
Document Fetching
      |
      v
Raw Document Storage
      |
      v
Content Extraction
      |
      v
Entity Detection
      |
      v
Entity Resolution
      |
      v
LLM Claim Extraction
      |
      v
Automatic Validation
      |
      v
Review Queue
      |
      v
Verified Claim Store
      |
      v
Graph Projection
      |
      +--> Public API
      |
      +--> Network Visualization
```

---

# 5. Source Registry

Implementiere ein zentrales Register für Datenquellen.

Jede Quelle beziehungsweise Domain benötigt eine eigene Konfiguration.

Beispiel:

```yaml
domain: example.ch
enabled: true
source_type: news
respect_robots: true
requests_per_minute: 10
concurrency: 1
javascript_required: false
store_raw_html: true
allow_llm_processing: true
publish_full_text: false
```

Unterstützte Quellentypen:

```text
OFFICIAL_REGISTER
PARLIAMENT
GOVERNMENT
COMPANY_REGISTER
COMPANY_WEBSITE
ORGANISATION_WEBSITE
NEWS_ARTICLE
PRESS_RELEASE
EVENT_PROGRAM
PDF
SOCIAL_MEDIA
MANUAL_RESEARCH
OTHER
```

---

# 6. Dokument-Ingestion

Ein Dokument repräsentiert einen konkreten abgerufenen Informationsstand.

Speichere mindestens:

```text
id
source_id
original_url
canonical_url
title
author
publisher
published_at
retrieved_at
content_type
language
raw_storage_path
extracted_text
content_hash
http_status
access_status
extraction_status
created_at
updated_at
```

Mögliche `access_status`:

```text
PUBLIC
PAYWALLED
BLOCKED
LOGIN_REQUIRED
REMOVED
UNKNOWN
```

Mögliche `extraction_status`:

```text
PENDING
SUCCESS
PARTIAL
METADATA_ONLY
FAILED
```

---

# 7. Raw Content Storage

Originalinhalte sollen von normalisierten Daten getrennt gespeichert werden.

Für HTML, PDF und andere grössere Dokumente soll Supabase Storage verwendet werden.

Die Datenbank speichert lediglich Referenzen auf die gespeicherten Dateien.

Beispiel:

```text
raw-documents/
  news/
  organisations/
  parliament/
  pdf/
```

Für jedes Dokument muss ein SHA-256-Hash gespeichert werden.

Damit sollen identische Dokumentversionen erkannt werden.

---

# 8. URL-Deduplizierung

Implementiere Canonicalization.

Entferne insbesondere:

```text
utm_source
utm_medium
utm_campaign
utm_content
utm_term
fbclid
gclid
```

Beachte zusätzlich:

* HTTP Redirects
* canonical HTML tags
* AMP URLs
* Print URLs
* URL-Fragmente
* Sprachvarianten

Mehrere URLs dürfen auf dasselbe Dokument zeigen.

---

# 9. Entity-Modell

## Tabelle `entities`

```text
id UUID PK
entity_type
canonical_name
slug
description
country_code
metadata JSONB
created_at
updated_at
```

Unterstützte Typen:

```text
PERSON
ORGANISATION
COMPANY
POLITICAL_PARTY
COMMITTEE
PARLIAMENT
GOVERNMENT_BODY
EVENT
INITIATIVE
ASSOCIATION
MEDIA_OUTLET
LOCATION
COUNTRY
OTHER
```

---

# 10. Entity Aliases

## Tabelle `entity_aliases`

```text
id
entity_id
alias
language
valid_from
valid_to
source_id
created_at
```

Beispiele:

```text
Jean-Luc Addor
Jean Luc Addor
J.-L. Addor
Nationalrat Addor
```

Aliases dürfen nicht automatisch als eindeutiger Identitätsbeweis gelten.

---

# 11. Personen

Für Personen sollen strukturierte Metadaten unterstützt werden.

Beispiel:

```json
{
  "first_name": "Jean-Luc",
  "last_name": "Addor",
  "birth_year": 1964,
  "party": "SVP",
  "canton": "VS"
}
```

Diese Daten sollen für Entity Resolution verwendet werden.

---

# 12. Events als First-Class Entities

Events müssen als eigene Entitäten gespeichert werden.

Nicht:

```text
Person A -> Organisation B
```

wenn lediglich eine gemeinsame Veranstaltung bekannt ist.

Stattdessen:

```text
Person A
  -> PARTICIPATED_IN
Event X

Event X
  -> ORGANISED_BY
Organisation B
```

Event-Metadaten:

```text
name
event_type
start_at
end_at
location
description
```

---

# 13. Claims

Eine Beziehung ist intern ein `Claim`.

## Tabelle `claims`

```text
id UUID PK

subject_entity_id UUID
predicate TEXT
object_entity_id UUID NULL

literal_value JSONB NULL

connection_class TEXT

valid_from DATE NULL
valid_to DATE NULL

confidence_score NUMERIC NULL
verification_status TEXT

created_by TEXT
reviewed_by UUID NULL
reviewed_at TIMESTAMPTZ NULL

supersedes_claim_id UUID NULL

created_at
updated_at
```

---

# 14. Erlaubte Relationsarten

Verwende eine kontrollierte Ontologie.

MVP:

```text
MEMBER_OF
PRESIDENT_OF
VICE_PRESIDENT_OF
BOARD_MEMBER_OF
EMPLOYED_BY
OWNS
SHAREHOLDER_OF
HAS_MANDATE_AT
MEMBER_OF_COMMITTEE
PARTICIPATED_IN
ORGANISED_BY
SPOKE_AT
MET_WITH
REPRESENTED
FUNDED_BY
SUPPORTED_INITIATIVE
SIGNED_DECLARATION
HAS_BUSINESS_ACTIVITY_IN
ISSUED_ACCESS_BADGE_TO
ADVISOR_TO
FOUNDED
PARTNER_OF
```

Keine frei erfundenen Relationstypen durch das Sprachmodell zulassen.

---

# 15. Connection Class

Jeder Claim benötigt zusätzlich eine Klassifikation.

Erlaubte Werte:

```text
DIRECT
INDIRECT
OFFICIAL
HISTORICAL
```

Beispiele:

```text
Präsident eines Verbandes
=> DIRECT

Bundeshaus-Badge für Lobbyist
=> INDIRECT

Treffen als Bundespräsident
=> OFFICIAL

Verwaltungsrat bis 2018
=> HISTORICAL
```

---

# 16. Claim Evidence

Jede Beziehung benötigt mindestens einen Evidenzdatensatz.

## Tabelle `claim_evidence`

```text
id
claim_id
document_id
evidence_text
context_before
context_after
start_char
end_char
page_number
section
evidence_hash
created_at
```

Ein Claim ohne Evidence darf nicht veröffentlicht werden.

---

# 17. Verification Status

Unterstütze:

```text
DETECTED
PENDING_REVIEW
VERIFIED
REJECTED
DISPUTED
OUTDATED
```

Nur:

```text
VERIFIED
```

darf standardmässig im öffentlichen Graph erscheinen.

---

# 18. Source Quality

Jede Quelle erhält eine Qualitätskategorie.

```text
A = offizielle Primärquelle
B = betroffene Organisation oder Unternehmen
C = mehrere seriöse journalistische Quellen
D = einzelne seriöse journalistische Quelle
E = indirekter oder schwacher Hinweis
X = widerlegt oder widersprochen
```

Speichere die Einstufung separat.

Die Einstufung muss manuell überschreibbar sein.

---

# 19. Article Discovery

Unterstütze verschiedene Discovery-Mechanismen.

MVP:

1. manuelle URL
2. RSS Feed
3. Sitemap
4. News Sitemap
5. definierte URL-Listen

Spätere Erweiterungen:

* Suchmaschinen
* Media Monitoring
* Common Crawl
* externe News APIs

Alle Discovery-Ergebnisse sollen zuerst als URL-Kandidaten gespeichert werden.

---

# 20. Web Fetcher

Implementiere einen Fetcher mit:

* Redirect Handling
* Timeout
* Retry Policy
* Rate Limiting
* User Agent
* robots.txt Prüfung
* Content-Type-Erkennung
* Hashing
* Deduplizierung

Standard:

```text
normaler HTTP Request
```

Fallback nur bei Bedarf:

```text
Headless Browser / Playwright
```

Browser Rendering nicht standardmässig verwenden.

---

# 21. Paywalls

Keine technische Umgehung von Paywalls implementieren.

Bei Paywalls:

* Metadaten speichern
* frei zugänglichen Text speichern
* `access_status = PAYWALLED`
* `extraction_status = METADATA_ONLY` oder `PARTIAL`

Der Benutzer kann später manuell Evidenz ergänzen, sofern er rechtmässigen Zugriff besitzt.

---

# 22. Article Extraction

Die Extraktion soll Hauptinhalt und Metadaten trennen.

Zu extrahieren:

```text
title
author
datePublished
publisher
description
articleBody
language
```

Strukturierte Metadaten bevorzugen:

1. JSON-LD
2. Schema.org
3. OpenGraph
4. HTML metadata
5. Extraktion aus sichtbarem Inhalt

---

# 23. LLM Entity Extraction

Das Sprachmodell soll zunächst Entitäten erkennen.

Output muss strukturiert sein.

Beispiel:

```json
{
  "entities": [
    {
      "local_id": "e1",
      "type": "PERSON",
      "name": "Max Muster",
      "evidence": "Nationalrat Max Muster"
    },
    {
      "local_id": "e2",
      "type": "COMPANY",
      "name": "Muster Arms AG",
      "evidence": "Muster Arms AG"
    }
  ]
}
```

Keine neu erkannte Entität direkt mit einer bestehenden Entität zusammenführen.

---

# 24. Entity Resolution

Nach Entity Extraction erfolgt Entity Resolution.

Matching-Signale:

```text
canonical_name
aliases
party
canton
position
company
organisation
country
time period
co-mentioned entities
```

Ergebnis:

```json
{
  "mention": "Nationalrat Müller",
  "candidate_entity_id": "...",
  "score": 0.93,
  "signals": [
    "same surname",
    "same office",
    "same canton"
  ]
}
```

Unterhalb eines konfigurierbaren Schwellenwerts:

```text
manual_review_required = true
```

Keine automatische Zuordnung bei mehrdeutigen Personen.

---

# 25. LLM Relation Extraction

Nach Entity Resolution soll ein Sprachmodell Beziehungskandidaten extrahieren.

Das Modell erhält:

* vollständigen relevanten Textabschnitt
* erkannte Entitäten
* erlaubte Relationstypen
* genaue Definition der Relationstypen

Das Modell darf keine Informationen ergänzen, die nicht im Text vorhanden sind.

---

# 26. LLM Output Schema

Beispiel:

```json
{
  "relations": [
    {
      "subject_entity_id": "uuid",
      "predicate": "PARTICIPATED_IN",
      "object_entity_id": "uuid",
      "connection_class": "DIRECT",
      "valid_from": "2026-05-10",
      "valid_to": "2026-05-10",
      "evidence_text": "Max Muster nahm am Sicherheitsforum teil.",
      "confidence": 0.91,
      "requires_review": true
    }
  ]
}
```

Die API-Ausgabe muss gegen ein JSON Schema validiert werden.

Invalides Modell-Output muss verworfen oder erneut verarbeitet werden.

---

# 27. LLM Extraction Rules

Das Modell muss folgende Regeln erhalten:

```text
Extrahiere nur ausdrücklich belegte Beziehungen.

Keine Beziehung aufgrund gemeinsamer Erwähnung erzeugen.

Eventteilnahme ist keine Mitgliedschaft.

Politische Zustimmung ist keine Lobbyfunktion.

Ein Treffen ist keine Mitgliedschaft.

Ein amtliches Treffen muss als OFFICIAL klassifiziert werden.

Historische Rollen müssen mit einem Zeitraum versehen werden.

Verneinte Beziehungen dürfen nicht als positive Beziehungen extrahiert werden.

Zitate müssen von Aussagen des Mediums unterschieden werden.

Bei Unsicherheit requires_review = true setzen.

Keine Informationen erfinden.

Wenn keine Beziehung eindeutig belegt ist, eine leere Relationsliste zurückgeben.
```

---

# 28. Evidence Verification

Nach dem LLM-Aufruf muss das System automatisch kontrollieren:

1. Existiert `evidence_text` tatsächlich im Quelldokument?
2. Kommt das Subjekt im relevanten Kontext vor?
3. Kommt das Objekt im relevanten Kontext vor?
4. Ist die Relation erlaubt?
5. Ist die Relation mit dem Entity-Typ kompatibel?
6. Ist der Zeitraum plausibel?
7. Enthält die Evidenz eine Negation?
8. Ist die Entitätsauflösung eindeutig?

Fehlgeschlagene Prüfungen:

```text
PENDING_REVIEW
```

oder:

```text
REJECTED
```

Keine automatische Veröffentlichung.

---

# 29. Zweiter LLM-Validator

Optional einen zweiten Modellaufruf implementieren.

Input:

* Originalabschnitt
* vorgeschlagener Claim
* Definition der Relation

Output:

```text
SUPPORTED
CONTRADICTED
INSUFFICIENT
```

Der Validator darf keinen neuen Claim erzeugen.

---

# 30. Confidence

LLM Confidence nicht als verlässliche Wahrscheinlichkeit behandeln.

Zusätzlich ein deterministisches Evidence Score berechnen.

Beispiel:

```text
+3 explizite Funktion genannt
+2 Subjekt und Objekt im selben Satz
+2 offizielle Quelle
+1 Datum vorhanden

-1 Pronomenauflösung nötig
-3 mehrdeutige Person
-3 nur indirekte Formulierung
```

Speichere separat:

```text
llm_confidence
evidence_score
```

---

# 31. Review Queue

Implementiere eine interne Review-Oberfläche.

Ein Reviewer muss sehen:

```text
Subject
Predicate
Object

Connection Class

Quelle
URL
Publisher
Datum

Evidence Text
Kontext davor
Kontext danach

Entity Resolution

LLM Confidence
Evidence Score
Source Quality
```

Aktionen:

```text
VERIFY
EDIT
REJECT
MARK_DISPUTED
MERGE_ENTITY
CREATE_ENTITY
```

---

# 32. Änderungen an Claims

Ein verifizierter Claim darf nicht still überschrieben werden.

Bei Änderungen:

```text
alter Claim
    ↓
valid_to setzen

neuer Claim
    ↓
supersedes_claim_id = alter Claim
```

Dadurch bleibt die Historie erhalten.

---

# 33. Audit Log

Alle redaktionellen Änderungen protokollieren.

## Tabelle `audit_log`

```text
id
actor_id
action
entity_type
entity_id
previous_value JSONB
new_value JSONB
created_at
```

Zu protokollieren:

* Claim verifiziert
* Claim abgelehnt
* Claim verändert
* Entity zusammengeführt
* Quelle geändert
* Beziehung gelöscht
* Relationship Classification geändert

---

# 34. Crawl Runs

## Tabelle `crawl_runs`

```text
id
source_id
started_at
finished_at
status
urls_discovered
documents_fetched
documents_changed
documents_failed
error_log
```

Dadurch müssen Crawls nachvollziehbar sein.

---

# 35. Scheduled Crawls

Unterstütze periodische Jobs.

Beispiele:

```text
Parlamentsdaten: täglich
Organisationen: wöchentlich
RSS: stündlich
Sitemaps: täglich
bestehende Profile: wöchentlich
```

Die Frequenzen müssen konfigurierbar sein.

---

# 36. Change Detection

Bereits bekannte URLs sollen erneut geprüft werden können.

Vergleiche:

```text
content_hash_old
content_hash_new
```

Bei unverändertem Hash:

```text
keine erneute LLM-Analyse
```

Bei Änderung:

```text
neue Dokumentversion
    ↓
Claim Extraction
    ↓
bestehende Claims vergleichen
```

---

# 37. Document Versions

Dokumente dürfen bei Änderungen nicht überschrieben werden.

Modell:

```text
source URL
  |
  +-- document version 1
  +-- document version 2
  +-- document version 3
```

Dadurch lassen sich historische Aussagen rekonstruieren.

---

# 38. Graph API

Erzeuge den Graph dynamisch aus verifizierten Claims.

Beispiel:

```http
GET /api/graph
```

Filter:

```text
entity_type
predicate
connection_class
topic
person
organisation
date_from
date_to
include_historical
```

Antwort:

```json
{
  "nodes": [],
  "edges": []
}
```

---

# 39. Node API

```http
GET /api/entities/:id
```

Antwort soll enthalten:

```text
Entity
Aliases
Verified Claims
Connected Entities
Events
Sources
Timeline
```

---

# 40. Edge API

Jede sichtbare Netzwerkverbindung muss Detailinformationen liefern.

```http
GET /api/claims/:id
```

Antwort:

```text
Subject
Relation
Object
Classification
Validity
Evidence
Sources
Verification status
```

---

# 41. Netzwerkvisualisierung

Die öffentliche Webanwendung soll einen interaktiven Graph anzeigen.

Node-Typen:

```text
Person
Organisation
Firma
Kommission
Event
Initiative
Land
```

Der Graph soll unterstützen:

* Zoom
* Pan
* Drag
* Node Selection
* Edge Selection
* Search
* Filtering
* Highlight Neighbours
* Cluster
* Detail Panel

---

# 42. Visuelle Beziehungstypen

Unterscheide mindestens:

```text
DIRECT
INDIRECT
OFFICIAL
HISTORICAL
```

Visuelle Umsetzung soll über unterschiedliche Linienarten erfolgen.

Historische Verbindungen müssen optisch klar von aktuellen Verbindungen unterscheidbar sein.

---

# 43. Filter

Mindestens folgende Filter implementieren:

```text
Person
Organisation
Firma
Relation
Connection Class
Zeitraum
Quelle
Source Quality
Partei
Kanton
Thema
```

Zusätzlich:

```text
nur aktuelle Beziehungen
nur direkte Beziehungen
historische Beziehungen anzeigen
```

---

# 44. Person Detail View

Für jede Person eine Detailansicht erstellen.

Inhalt:

```text
Name
Partei
Mandat
Beruf
Organisationen
Firmen
Kommissionen
Events
Initiativen
weitere Beziehungen
Timeline
Quellen
```

Jede Verbindung muss anklickbar sein.

---

# 45. Timeline

Implementiere eine zeitliche Ansicht.

Beispiel:

```text
2018    Präsident Organisation X
2019    Event Y
2020    Verwaltungsrat Firma Z
2022    Treffen A
2026    Ehrenpräsident Organisation X
```

---

# 46. Quellenanzeige

Jeder Claim muss im Frontend mindestens anzeigen:

```text
Quelle
Titel
Publisher
Veröffentlichungsdatum
Abrufdatum
URL
Evidence
```

Keine Edge ohne erreichbare Quelleninformation anzeigen.

---

# 47. Rechercheansicht

Zusätzlich zur Netzwerkansicht soll eine Tabellenansicht vorhanden sein.

Spalten:

```text
Person
Relation
Ziel
Connection Class
Valid From
Valid To
Source
Verification
```

Filter und Sortierung ermöglichen.

---

# 48. Suche

Globale Suche über:

```text
Personen
Organisationen
Firmen
Events
Kommissionen
Initiativen
```

Aliasnamen müssen berücksichtigt werden.

---

# 49. Topic Tags

Entities und Claims können zusätzliche Tags besitzen.

Beispiele:

```text
RUeSTUNGSINDUSTRIE
WAFFENRECHT
RUSSLAND
ENERGIE
IMMOBILIEN
LANDWIRTSCHAFT
FINANZEN
VERKEHR
SICHERHEITSPOLITIK
```

Tags dürfen keine Fakten ersetzen.

Ein Tag wie `RUSSLAND` ist lediglich eine Klassifikation eines bereits belegten Claims.

---

# 50. Sensitive Topic Handling

Für sensible Kategorien wie:

```text
Russland
Rüstungsindustrie
Waffenlobby
Extremismus
finanzielle Interessen
Korruptionsvorwürfe
```

muss immer menschliche Verifikation verlangt werden.

Kein automatisches Publishing.

---

# 51. Benutzerrollen

Mindestens:

```text
ADMIN
RESEARCHER
REVIEWER
PUBLIC
```

### ADMIN

Vollzugriff.

### RESEARCHER

Kann:

* Quellen hinzufügen
* Dokumente importieren
* Entities erstellen
* Claims vorschlagen

### REVIEWER

Kann Claims:

* verifizieren
* korrigieren
* ablehnen
* als disputed markieren

### PUBLIC

Nur Zugriff auf veröffentlichte Daten.

---

# 52. Supabase Row Level Security

RLS aktivieren.

Öffentliche Benutzer dürfen nur Daten lesen, die für Veröffentlichung freigegeben sind.

Insbesondere darf die öffentliche API nicht liefern:

```text
PENDING_REVIEW
REJECTED
interne Reviewer-Kommentare
private Audit-Daten
Crawler Credentials
LLM Prompts mit internen Daten
```

---

# 53. Secrets

Keine API Keys in:

* Client Code
* Git Repository
* Datenbankinhalten
* Logs

verwenden.

Secrets ausschliesslich über sichere Umgebungsvariablen beziehungsweise Secret Management bereitstellen.

---

# 54. LLM Provider Abstraction

LLM-Zugriff hinter einer eigenen Service-Abstraktion implementieren.

Beispiel:

```text
extractEntities()
resolveEntityCandidates()
extractClaims()
validateClaim()
```

Business Logic darf nicht direkt von einem konkreten Modellnamen abhängig sein.

---

# 55. Prompt Versioning

Jeder LLM-Lauf muss speichern:

```text
model
prompt_version
schema_version
temperature
created_at
```

Dadurch muss später nachvollziehbar sein, mit welcher Extraktionslogik ein Claim erzeugt wurde.

---

# 56. LLM Run Logging

## Tabelle `llm_runs`

```text
id
document_id
operation
provider
model
prompt_version
input_hash
output JSONB
status
error
created_at
```

Speichere nach Möglichkeit nicht unnötig komplette urheberrechtlich geschützte Artikeltexte im Log.

---

# 57. Fehlerbehandlung

Fehler in einem Dokument dürfen die gesamte Pipeline nicht stoppen.

Jede Pipeline-Stufe benötigt:

```text
PENDING
RUNNING
SUCCESS
FAILED
SKIPPED
```

Fehler müssen erneut verarbeitet werden können.

---

# 58. Idempotenz

Alle Jobs müssen idempotent implementiert werden.

Wiederholtes Crawlen derselben URL darf nicht automatisch Duplikate erzeugen.

Wiederholte LLM-Verarbeitung desselben Dokument-Hashes soll vermieden werden.

---

# 59. Observability

Implementiere Logs für:

* Fetch failures
* Parsing failures
* LLM failures
* Invalid JSON
* Entity Resolution ambiguity
* Claim validation errors
* Crawl statistics

Keine Secrets oder vollständigen sensiblen Inhalte loggen.

---

# 60. MVP

Der erste produktive Stand soll bewusst klein bleiben.

## MVP Scope

Implementiere:

### Daten

* Entities
* Aliases
* Sources
* Documents
* Claims
* Claim Evidence
* Review Queue

### Ingestion

* manuelle URL
* RSS
* Sitemap

### Verarbeitung

* HTML Extraction
* Entity Extraction
* Entity Resolution
* Claim Extraction
* Evidence Validation

### Review

* Claims ansehen
* bearbeiten
* verifizieren
* ablehnen

### Public

* Netzwerkansicht
* Personensuche
* Detailansicht
* Quellenanzeige
* Filter

---

# 61. Nicht Bestandteil des ersten MVP

Noch nicht implementieren:

* vollautomatisches Web Crawling des gesamten Internets
* automatische Veröffentlichung
* automatische Bewertung politischer Nähe
* Sentiment Analysis als Fakt
* Neo4j
* komplexe Machine-Learning-Klassifikatoren
* automatisches Umgehen von Paywalls
* Social-Media-Massenüberwachung
* Gesichtserkennung
* personenbezogenes Scoring

---

# 62. Empfohlene Entwicklungsreihenfolge

## Phase 1

Supabase Schema erstellen:

```text
entities
entity_aliases
sources
documents
claims
claim_evidence
```

Seed-Daten hinzufügen.

---

## Phase 2

Admin UI erstellen:

```text
Entities
Sources
Documents
Claims
Review Queue
```

---

## Phase 3

Manuelle URL-Ingestion implementieren.

```text
URL
 ↓
fetch
 ↓
extract
 ↓
store document
```

---

## Phase 4

LLM Entity Extraction implementieren.

Noch keine Relation Extraction.

Entity-Erkennung mit realen Artikeln testen.

---

## Phase 5

Entity Resolution implementieren.

Ambiguous Matches müssen in die Review Queue gelangen.

---

## Phase 6

Claim Extraction implementieren.

```text
Document
 ↓
Entities
 ↓
LLM
 ↓
Candidate Claims
 ↓
Validation
 ↓
Review
```

---

## Phase 7

Review Workflow implementieren.

---

## Phase 8

Public Graph implementieren.

Nur:

```text
verification_status = VERIFIED
```

anzeigen.

---

## Phase 9

RSS und Sitemap Discovery hinzufügen.

---

## Phase 10

Change Detection und Scheduling implementieren.

---

# 63. Akzeptanzkriterien

## AC-01

Wenn eine URL zweimal importiert wird und sich der Inhalt nicht geändert hat, darf kein zweites identisches Dokument entstehen.

## AC-02

Das Sprachmodell darf nur Relationstypen aus der definierten Ontologie zurückgeben.

## AC-03

Ein Claim ohne Evidenz darf nicht verifiziert werden.

## AC-04

Der gespeicherte Evidenztext muss im Quelldokument nachweisbar sein.

## AC-05

Ein `PENDING_REVIEW` Claim darf nicht im öffentlichen Graph erscheinen.

## AC-06

Ein `REJECTED` Claim darf nicht im öffentlichen Graph erscheinen.

## AC-07

Historische Funktionen müssen von aktuellen Funktionen unterscheidbar sein.

## AC-08

Ein Event muss als eigene Entity modelliert werden können.

## AC-09

Mehrere Claims dürfen dieselbe Quelle verwenden.

## AC-10

Ein Claim darf mehrere Quellen besitzen.

## AC-11

Ein Claim muss nachträglich korrigiert werden können, ohne die Historie zu verlieren.

## AC-12

Jede veröffentlichte Edge muss mindestens eine Quelle anzeigen.

## AC-13

Mehrdeutige Entity Matches dürfen nicht automatisch zusammengeführt werden.

## AC-14

Paywalls dürfen nicht technisch umgangen werden.

## AC-15

Ein fehlgeschlagener Crawl darf andere Crawl Jobs nicht blockieren.

## AC-16

Alle Crawl- und Analysejobs müssen erneut ausführbar sein.

## AC-17

Alle redaktionellen Änderungen müssen im Audit Log nachvollziehbar sein.

## AC-18

Öffentliche Benutzer dürfen interne Review-Daten nicht lesen.

---

# 64. Qualitätsanforderung für das LLM

Teste die Relation Extraction mit einem kuratierten Testdatensatz.

Dieser soll mindestens enthalten:

```text
positive Beziehung
verneinte Beziehung
historische Beziehung
amtliches Treffen
Eventteilnahme
gemeinsame Erwähnung ohne Beziehung
Zitat einer Drittperson
widersprochene Behauptung
mehrdeutiger Personenname
mehrere Personen mit gleicher Organisation
```

Für jeden Testfall muss ein erwarteter strukturierter Output definiert werden.

Automatisierte Regressionstests erstellen.

---

# 65. Beispiel für einen kritischen Test

Input:

```text
Nationalrat Max Muster nahm an einer Veranstaltung teil,
an der auch Vertreter der Example Arms AG anwesend waren.
```

Nicht zulässig:

```text
Max Muster MEMBER_OF Example Arms AG
Max Muster EMPLOYED_BY Example Arms AG
Max Muster REPRESENTED Example Arms AG
```

Zulässig:

```text
Max Muster PARTICIPATED_IN Event X
```

sofern die Eventteilnahme eindeutig belegt ist.

---

# 66. Beispiel für amtlichen Russland-Kontakt

Input:

```text
Bundespräsident Max Muster traf in Moskau den russischen Präsidenten.
```

Zulässig:

```text
Max Muster PARTICIPATED_IN Meeting X
Russian President PARTICIPATED_IN Meeting X
Meeting X HELD_IN Moscow
```

oder bei entsprechend definierter Ontologie:

```text
Max Muster MET_WITH Russian President
connection_class = OFFICIAL
```

Nicht automatisch zulässig:

```text
Max Muster HAS_RUSSIAN_CONNECTION
Max Muster SUPPORTS_RUSSIA
Max Muster MEMBER_OF_RUSSIAN_LOBBY
```

---

# 67. Definition of Done für einen veröffentlichten Claim

Ein Claim gilt erst als veröffentlichungsfähig, wenn:

* Subject aufgelöst ist
* Object aufgelöst ist
* Predicate gültig ist
* Quelle vorhanden ist
* Evidenz vorhanden ist
* Evidenz technisch geprüft wurde
* Zeitraum soweit möglich bestimmt ist
* Connection Class gesetzt ist
* Reviewer den Claim freigegeben hat
* Audit-Eintrag vorhanden ist

Erst danach:

```text
verification_status = VERIFIED
```

setzen.

---

# 68. Entwicklungsprinzip für Codex

Vor Implementierung:

1. bestehendes Repository analysieren
2. vorhandenen Stack identifizieren
3. vorhandene Supabase-Struktur prüfen
4. vorhandene Tabellen und Migrationen nicht unkontrolliert ersetzen
5. Implementierungsplan erstellen
6. Migrationen in kleinen, nachvollziehbaren Schritten erstellen
7. jede Phase testen

Falls bereits eine Frontend- oder Backend-Architektur vorhanden ist, diese bevorzugen.

Bei einem Greenfield-Projekt darf eine sinnvolle Standardarchitektur gewählt werden.

Keine unnötigen Frameworks oder Infrastrukturkomponenten hinzufügen.

---

# 69. Priorität

Bei Zielkonflikten gilt folgende Reihenfolge:

```text
1. Nachvollziehbarkeit
2. Datenintegrität
3. Quellenqualität
4. menschliche Kontrolle
5. historische Korrektheit
6. Benutzerfreundlichkeit
7. Automatisierungsgrad
8. Geschwindigkeit
```

Das System soll lieber einen Claim zur manuellen Prüfung markieren, als eine nicht belegte Beziehung automatisch zu veröffentlichen.
