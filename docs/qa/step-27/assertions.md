Step 27 QA assertion summary

Database: disposable PostgreSQL on 127.0.0.1:55434 (step27_final / step27_historical)
Migrations: 001-059 applied; repeat run: Database is up to date
Historical upgrade: PASS — messages and participant state preserved; deleted history boundary backfilled; unknown origin remains unknown
Full backend suite: Test Files 51 passed | 1 skipped; Tests 288 passed | 1 skipped
Focused backend suite after final server changes: Test Files 4 passed; Tests 35 passed
Additional deal-chat reopening test after personal deletion: 1 passed (8 other tests filtered out)
TypeScript: npm run typecheck — PASS
Chromium: 1 passed — product/profile separation; failed-response retry without duplicate; 390 px send/unread/read; saved/trash/restore on 390 and 1280; viewport 320/390/768/1024/1280/1440; search and keyboard menu; menu boundaries including synthetic bottom edge; two-tab unread synchronization; request/offer cards and reused deal conversation

Preparation used API and isolated tester users; browser interactions are specified in chat.spec.ts.
Physical mobile keyboard and UI creation of Offer/Deal are unverified; see README.md for final scope.
