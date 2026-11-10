# Fixifoot on iPad – staff test checklist

Use an iPad (Safari, then the Home Screen app). These steps confirm scanning, signing in, and saving files work on the iPad itself. A computer browser can only go so far.

## 1. Add Fixifoot to the Home Screen
1. In **Safari**, open https://jackypartush1508-art.github.io/fixifoot-demo/
2. Tap the **Share** button, then **Add to Home Screen**.
3. Open the new **Fixifoot** icon. The address bar should be gone (standalone mode).

## 2. Sign in (staff)
1. Tap **Staff view**.
2. Sign in with your Fixifoot staff email and password.
3. You should land on the staff dashboard and see customers from the cloud.
4. Close the app completely (swipe it away from the app switcher) and open it again from the Home Screen icon.
5. You should still be signed in. If you see “You are signed out”, sign in again. The Home Screen app keeps its own login, separate from Safari.

## 3. Scan a foot and export the file
Use one of these apps (or any app that can export a foot scan):

- **3d Scanner App** – scan the foot, then Share / Export as **STL** or **OBJ** to the **Files** app.
- **Heges** – scan, then export **STL** or **PLY** to **Files**.
- **Polycam** – scan, export **OBJ** or **STL** to **Files**. A ZIP of an OBJ is also fine.

Name the files clearly (for example `right-foot.stl` and `left-foot.obj`).

## 4. Upload the scan
1. In the Home Screen app, stay in staff view (or start a new scan visit for a customer).
2. Tap **Upload** and choose the file from **Files**. You should be able to pick `.stl`, `.obj`, `.ply`, and `.zip` files – if a file is greyed out, tap **Browse** and look in the folder where you saved the export.
3. Wait for “Loading / Fitting the scan…”. A very detailed scan is automatically simplified so the iPad does not run out of memory.
4. Check the 3D view: you should see the foot, and left/right should be detected automatically. Rotate with one finger; pinch to zoom. The page itself should not scroll or zoom while you are dragging the model.
5. Repeat for the other foot.

## 5. Download print files to Files
1. On the staff dashboard, tap **Download STL – Right** (and Left).
2. If a share sheet appears, choose **Save to Files**. If the file opens in a new view, tap Share → **Save to Files**.
3. Do the same for **Download 2-material 3MF** (for two-colour products) and for a **Receipt PDF** (open a customer order → receipt → Download PDF).
4. In the **Files** app, confirm the `.stl` / `.3mf` / `.pdf` files are there.

## 6. Rotate the iPad
1. Turn the iPad to landscape.
2. The 3D view should resize to fill the space. On the design screen, colours sit beside the 3D view. In **Customers**, the list stays on the left and the customer card on the right.
3. Turn back to portrait – everything should still work.

## 7. If something goes wrong
- “This does not look like an STL, OBJ or PLY” – export again from the scanner app, or ZIP the OBJ with its `.mtl` file.
- The 3D view goes blank or says it ran out of memory – export a smaller or simplified scan and try again.
- You are signed out after reopening – sign in once more inside the Home Screen app (not only in Safari).
- A download does nothing – use the share sheet and **Save to Files**.
