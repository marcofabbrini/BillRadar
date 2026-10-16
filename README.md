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
