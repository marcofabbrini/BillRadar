# BillRadar

App Android per monitorare e analizzare i consumi domestici. Legge da Gmail le mail con le bollette in PDF, ne estrae i dati e li archivia **solo sul telefono** (IndexedDB, nessun server).

**Categorie:** luce, gas, acqua, internet/telefono, bollo auto, manutenzione auto, acconti GSE (impianto fotovoltaico, contati come entrate).

## Cosa fa

- **Home:** spese e acconti GSE dell'anno, confronto con l'anno precedente, grafico mensile, scadenze.
- **Documenti:** elenco filtrabile, modifica dei dati estratti, anteprima del PDF originale, inserimento manuale, flag "pagata".
- **Statistiche:** spesa mensile, consumi (kWh / Smc / m³), prezzo medio per unità, costo netto energia (luce − GSE).
- **Impostazioni:** definite in `src/settings.js`. Per aggiungere una funzione futura basta aggiungere una voce a quel file: la schermata la mostra da sola.

## Installare l'APK

1. Tab **Actions → Build APK → Run workflow** (parte anche a ogni push su `main`).
2. Scarica `BillRadar.apk` dalla **Release "latest"** e installalo (abilita "origini sconosciute").
3. Gli aggiornamenti successivi si installano sopra la versione esistente (la firma è fissa).

## Collegare Gmail (una tantum)

L'app usa il login Google nel browser di sistema (OAuth + PKCE, sola lettura `gmail.readonly`). Serve un tuo Client ID:

1. [Google Cloud Console](https://console.cloud.google.com/) → nuovo progetto "BillRadar".
2. **API e servizi → Libreria** → abilita **Gmail API**.
3. **Schermata consenso OAuth** → tipo *Esterno*, stato *Test*, aggiungi il tuo indirizzo Gmail tra gli **utenti di test**.
4. **Credenziali → Crea credenziali → ID client OAuth** → tipo **Android**:
   - Nome pacchetto: `com.marcofabbrini.billradar`
   - Impronta SHA-1: `C2:6D:AE:1C:17:D4:23:CC:BC:13:B2:5B:C8:D5:C7:53:6D:F4:E2:B8`
   - se presente, attiva *"Abilita schema URI personalizzato"* nelle impostazioni avanzate.
5. Copia il Client ID in **App → Impostazioni → Gmail → Google OAuth Client ID**, poi tocca **Collega Gmail**.

### Collegamento permanente

Il collegamento resta attivo da solo (l'app rinnova il token a ogni apertura), **ma solo se la schermata di consenso è in produzione**:

1. Google Cloud Console → **Schermata consenso OAuth** (o *Google Auth Platform → Pubblico*).
2. Premi **Pubblica app** / *Passa a produzione*. Non serve la verifica Google per uso personale.
3. Al primo login vedrai "Google non ha verificato questa app": **Avanzate → Vai a BillRadar (non sicuro)** e consenti. Succede una volta sola.

Se la lasci in *Test*, Google fa scadere il collegamento dopo 7 giorni. Se capita (o se revochi l'accesso), la Home mostra il pulsante **Riconnetti Gmail**: un tocco e riparte, senza perdere i dati.

## Archivio su Google Drive (facoltativo)

In **Impostazioni → Google Drive** attivi "Archivia su Google Drive": ogni PDF viene copiato nel tuo Drive, a partire dalla root, in

```
BillRadar / Anno / MM - Mese / Tipologia / data Tipologia Fornitore importo.pdf
```

Esempio: `BillRadar/2026/03 - Marzo/Luce/2026-03-12 Luce Enel Energia 98,45 EUR.pdf`.

Per attivarlo:
1. Google Cloud → **API e servizi → Libreria** → abilita **Google Drive API**.
2. (Facoltativo) **Accesso ai dati → Aggiungi ambiti**: `.../auth/drive.file`.
3. Attiva l'interruttore nell'app: Google chiede il consenso solo in quel momento. Il permesso `drive.file` è non sensibile e l'app vede solo ciò che crea lei.
4. "Archivia ora" carica i documenti già presenti; nel dettaglio di ogni bolletta c'è "Salva su Drive".

Nota: con `drive.file` l'app non riusa una cartella "BillRadar" creata a mano; ne crea una propria.

### Nessun doppione, backup e ripristino

- Prima di caricare, l'app cerca nella cartella di destinazione un file con lo stesso nome: se c'è, ne aggiorna il contenuto invece di crearne un secondo. Se modifichi una bolletta (categoria, data, fornitore, importo) il file su Drive viene rinominato e spostato di conseguenza.
- **Backup** (JSON con i dati estratti) in `BillRadar/Service/billradar-backup-AAAA-MM-GG.json`: un file al giorno, quello dello stesso giorno viene sovrascritto. Manuale da "Esegui backup su Drive", oppure automatico dopo ogni sincronizzazione.
- **Ripristino**: "Ripristina da Drive" prende l'ultimo backup e reinserisce i documenti senza duplicare quelli già presenti. I PDF restano su Drive e si aprono da "Vedi PDF". Per ritrovare i file dopo una reinstallazione serve lo stesso Client ID.
- **Libera spazio**: toglie dal telefono i PDF già presenti su Drive (controlla uno per uno che esistano ancora). Impostazioni → Dati mostra quanto spazio occupano i documenti.

## Immobili e vetture

In **Impostazioni → Immobili e vetture** registri ogni casa o auto con **intestatario** delle utenze, **indirizzo della fornitura** e, se vuoi, **codici** (POD, PDR, targa, numero contratto). **Ogni bolletta deve riferirsi a uno di essi** (campo obbligatorio nel dettaglio del documento). Un titolare può avere più immobili: ciascuno ha la sua scheda e le utenze di tipo diverso (luce, gas, acqua…) finiscono all'immobile giusto in base all'indirizzo.

Per ogni nuova bolletta trovata in Gmail l'app legge dal PDF intestatario e indirizzo di fornitura e li **verifica**, in quest'ordine:

1. **Codici** (POD, PDR, targa…) presenti nel PDF: sono univoci e decidono da soli.
2. **Indirizzo + intestatario**: se l'indirizzo coincide con un solo immobile e l'intestatario coincide (o non è registrato), la bolletta è assegnata.
3. **Assegnazione manuale** (la bolletta resta "da assegnare", con il motivo e, se possibile, un suggerimento da confermare) quando:
   - più schede hanno lo stesso indirizzo (intestatari diversi);
   - l'indirizzo coincide ma l'intestatario del documento è diverso;
   - il documento riporta un indirizzo che non è tra i tuoi immobili.
4. Se il documento non riporta né indirizzo né intestatario e c'è un solo bene adatto (un immobile per le utenze, una vettura per bollo e manutenzione), viene assegnata a quello.

Quando assegni a mano una bolletta, la scelta si estende solo alle altre ancora senza bene con **stessa categoria, fornitore, intestatario e indirizzo**: un titolare con più immobili non viene mai mescolato. **Verifica le bollette già presenti** rilegge i PDF sul telefono e riassegna quelle senza bene o assegnate in automatico (quelle scelte a mano non si toccano).

Il **filtro** per immobile/vettura è in Home, Documenti, Statistiche e nell'elenco per categoria; in Home un avviso segnala le bollette da assegnare. Eliminare un immobile o una vettura non cancella le bollette: tornano "da assegnare".

## Personalizzazione

**Impostazioni → Aspetto → Colore della striscia in alto**: scegli tra i colori proposti o un colore a piacere.

## Filtro delle mail

In **Impostazioni → Gmail** scegli quali mail analizzare:

- **Indirizzi da cui arrivano le bollette**: uno per riga (indirizzo completo, oppure un intero dominio come `@enel.com`). Di default: `noreply.enelenergia@enel.com` e `contotelefonico@fatturazione.windtre.it`.
- **Testo contenuto nella mail**: facoltativo; la mail deve contenere almeno uno dei testi (oggetto o corpo).
- **Cerca anche per parole generiche**: aggiunge le mail con "bolletta", "fattura", "GSE", "bollo"… di qualsiasi mittente (spento di default).

Sotto i campi vedi la ricerca Gmail che ne risulta. Solo le mail con un PDF allegato vengono considerate: i mittenti non elencati non vengono letti.

## Quando l'app cerca le bollette

- **All'apertura** (se attivo in Impostazioni → Gmail): guarda solo le mail degli ultimi 7 giorni.
- **Tasto ⟳ in alto**: controlla le sole mail arrivate dall'ultimo controllo fino ad adesso.
- **Impostazioni → Gmail → Sincronizza storico**: cerca le bollette più vecchie nel periodo scelto (ultimi 3 mesi, 1 anno, 3 anni, tutto). Da usare la prima volta e quando vuoi recuperare arretrati.
- Quando arrivano bollette nuove compare in Home un avviso con quante sono e di che tipo, finché non lo chiudi.

## Categorie per immobili e per vetture

Ogni categoria è riferita a immobili o a vetture. **Immobili:** Luce, Gas, Acqua, Internet/Telefono, Acconti GSE. **Vetture:** Bollo, Manutenzione, Tagliando, Carburante, Assicurazione, Ricarica. Nel dettaglio di un documento, scegliendo la categoria l'elenco "Immobile / vettura" mostra solo i beni coerenti, e l'assegnazione automatica non abbina mai una bolletta di casa a un'auto o viceversa. Le categorie create da te hanno il campo "Si riferisce a" (immobili o vetture).

## Eliminazione multipla e duplicati

In **Documenti** e in **Spese**, "☑️ Seleziona" permette di spuntare più voci (o "Tutte" quelle filtrate) ed eliminarle in un colpo solo. Le bollette eliminate non vengono più riportate indietro dalla sincronizzazione con Gmail. I file già archiviati su Drive non vengono toccati.

"🔍 Duplicati" (anche in Impostazioni → Dati) confronta i documenti partendo dal **periodo di fatturazione** (o, se manca, dalla data del documento) a parità di categoria; poi controlla importo, fornitore, numero documento e immobile/vettura. **Sicuri:** stesso file (allegato email, PDF, Drive), stesso numero con fornitore e importo, oppure stesso periodo con stesso fornitore e importo. **Da controllare:** stesso periodo e fornitore ma importo diverso, o stessa data e importo. Mai duplicati: fornitori, numeri documento, periodi o beni diversi. Per ogni gruppo l'app consiglia quale tenere (con PDF, assegnazione confermata a mano, pagata) e prepara l'eliminazione solo dei gruppi sicuri; in ogni gruppo ne resta sempre almeno uno.

Con **"✓ Non è un duplicato"** la scelta viene ricordata (anche nel backup): quei documenti non vengono più proposti. "Ripristina esclusioni" azzera la lista.

## Spese personali e scontrini

Oltre a immobili e vetture ci sono le **spese personali**, che non richiedono nessun immobile o vettura: **Spesa**, **Ristoranti**, **Spese informatica**, **Altre spese**. Per ognuna puoi creare le **sottocategorie** che vuoi (Impostazioni → Categorie → 🏷, oppure dal ＋ quando registri una spesa). Le categorie create da te possono essere "Spese personali" dal campo "Si riferisce a".

La scheda **Spese** serve a registrare le spese con il solo **totale**: importo, categoria e sottocategoria, negozio, data e, se vuoi, la foto dello scontrino (ridotta a max 1600 px per risparmiare spazio). L'elenco si filtra per anno, mese e categoria, con totali per categoria e per sottocategoria. Il proprietario si sceglie sulla singola spesa. Le foto restano sul telefono e non entrano nel backup JSON, che contiene i dati delle spese. L'app non legge il testo della foto.

## Analisi prezzi

La scheda **Prezzi** mostra, per l'ultima bolletta di ogni contratto (riconosciuto da POD/PDR, altrimenti da tipo, immobile e fornitore), il **prezzo finito**: totale della bolletta diviso i consumi, in €/kWh per la luce e €/Smc per il gas (Smc = standard metro cubo, l'unità con cui il gas è fatturato). Se nel PDF ci sono le voci ARERA, il prezzo è scomposto in materia prima, trasporto, oneri di sistema, imposte e IVA, con andamento sulle ultime bollette.

Nella stessa scheda puoi caricare **preventivi e contratti** (PDF): l'app legge prezzo, quota fissa e validità, tu controlli e correggi i valori, poi li confronta con il costo annuo del contratto attuale. Il confronto riguarda solo la componente *materia prima* (il resto è uguale per ogni fornitore) e usa il consumo annuo calcolato dalle tue bollette, modificabile. Le offerte entrano nel backup JSON (i PDF restano sul telefono).

## Widget

Tieni premuto sulla Home di Android → **Widget** → BillRadar "Andamento bollette". Alla creazione scegli quali serie mostrare (poi: tieni premuto il widget → Impostazioni). Si ridimensiona liberamente, anche a tutta larghezza; mostra l'andamento degli ultimi 12 mesi e un indicatore con le bollette nuove degli ultimi 7 giorni. Si aggiorna quando apri l'app o sincronizzi.

## Limiti noti

- I PDF scansionati come immagine (senza testo) non vengono letti: finiscono tra i "da verificare" o vengono saltati. Non c'è OCR.
- Il parser riconosce i formati più comuni; se un fornitore usa un layout particolare, correggi i campi dal dettaglio e segnalamelo per migliorare le regole in `src/parser.js`.
- Il filtro di ricerca Gmail è modificabile in Impostazioni (utile per aggiungere mittenti specifici).

## Sicurezza

Il repository è pubblico: contiene la chiave di firma di sviluppo (`android/app/billradar.keystore`, password `billradar`), pensata solo per l'installazione personale. Non contiene dati personali: bollette e token Gmail restano sul telefono. Se rendi il repo privato o vuoi una firma più protetta, sposta il keystore nei GitHub Secrets.

## Sviluppo

```bash
npm install
npm test          # test del parser
npm run dev       # anteprima nel browser (Gmail disponibile solo nell'APK)
npm run build && npx cap sync android
```

## Filtro per tipologia e caricamento di file
- Nel selettore dei beni (Home, Documenti, Statistiche…) il gruppo **Per tipologia** permette di vedere tutte le vetture, tutti gli immobili, "Altro" o le Spese: le categorie e i totali mostrati sono solo quelli della tipologia scelta (con le vetture non compare "Acqua").
- **Carica PDF o archivio .zip** (Documenti e Impostazioni): uno o più PDF, oppure un .zip (anche con cartelle) che li contiene. Ogni PDF è letto e catalogato come una bolletta di Gmail; un PDF identico a uno già presente viene saltato; i file non PDF sono ignorati.
