# Kriptiek Firebase Functions

## Authoritative locations

Frontend and Firebase project:

C:\Users\Willem\Projects\kriptiek-site

Firebase Functions source:

C:\Users\Willem\Projects\kriptiek-site\functions

Firebase project:

kriptiek-c9ea2

Region:

europe-west1

## Recovery record

The deployed Functions source was downloaded from Google Cloud on
12 July 2026.

The recovered checkDilemmaGuess revision was deployed on 30 March 2026.

Original recovery archive:

C:\Users\Willem\Projects\kriptiek-backend-recovery\checkDilemmaGuess-function-source-2026-03-30.zip

SHA256:

1821B7187DE620AABA53A456E21A3153B7AAD5373CF4676A0282466512798806

## Safe deployment procedure

1. Confirm the correct branch and a clean Git status.
2. Review the exact changes with git diff.
3. Run node --check functions/index.js.
4. Install locked dependencies inside functions with npm ci.
5. Confirm the selected Firebase project is kriptiek-c9ea2.
6. Deploy only explicitly named functions where possible.
7. Verify Firebase logs and the live feature after deployment.

Do not use a blanket production deployment without reviewing the
functions that will be changed.
