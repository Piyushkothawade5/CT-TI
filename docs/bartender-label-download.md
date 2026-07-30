# BarTender Label File Download Setup

Use this setup for the current SATO Special Edition BarTender UltraLite installation. The CT-TI app creates a TI-specific `.btw` file directly in the browser from the bundled fixed-size BarTender template, fills the TI label values, and downloads the generated file.

```text
CT-TI App -> bundled .btw template -> generated TI .btw download
```

## What This Does

- Clicking `Labels` downloads a generated `.btw` file for the current checked TI.
- If `public/label-templates/manifest.json` maps the item number to a bundled template, that item template is used as the visual base.
- If the item has multiple tap rows and no exact item template is mapped, the manifest's `multiTapTemplate` is used.
- If no item-specific template is mapped, `public/label-templates/ct-ti-label-template.btw` is used as the visual base.
- The generated file keeps the template's fixed label size and layout; only the embedded label values are patched.
- No local helper, Node service, Windows startup shortcut, or printer PC installer is required.

## Template Files

Bundled templates live here:

```text
public/label-templates/
```

Current files:

```text
ct-ti-label-template.btw
38400191-50-100.btw
ER00001360.btw
manifest.json
```

To add another item-specific `.btw`, place it in `public/label-templates` and add a manifest entry:

```json
{
  "defaultTemplate": "ct-ti-label-template.btw",
  "multiTapTemplate": "38400191-50-100.btw",
  "itemTemplates": [
    {
      "itemNos": ["38400191-50-100", "3840019150100"],
      "file": "38400191-50-100.btw"
    }
  ]
}
```

Templates in `public` are shipped with the app and can be downloaded by app users, so only approved label templates should be placed there.

## Daily Flow

1. Open a checked TI in the CT-TI app.
2. Click `Labels`.
3. The browser downloads `TI_NO-ITEM_NO-label.btw`.
4. Open the downloaded file in BarTender and print it manually.

## Notes

- This is not full print automation; it generates a downloadable `.btw` file for BarTender UltraLite.
- The app never changes the bundled templates. It patches only the downloaded job copy.
- For best results, the base template should contain long placeholder/sample text objects for every field. The app preserves BarTender's internal text lengths, so each placeholder must be at least as long as the longest real value expected.
- Recommended placeholder examples:

```text
SR.NO: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
ITEM NO: XXXXXXXXXXXXXXXXXXXXXXXXXXXX
CTR: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
S1-S2 : XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
IL : XXXXXXXXXXXXXXXXXXXX
STC: XXXXXXXXXXXXXXXXXXXX
FREQ.: XXXXXXXXXXXXX
INS CL: XXXXXXXXXXXX
IEC XXXXXXXXXXXXXXXXXXXXXXXXXXXXX
MADE IN INDIA
```

- Full automatic printing still requires BarTender Automation or Enterprise Automation.
