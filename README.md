# Insolvency Atlas

Compare Canadian insolvency filings and official annual rates in a static web app. The timeline, observation table and CSV all reflect the selected range, measure and comparison areas. The URL preserves the comparison.

- Monthly filings can be compared for Canada, provinces and territories, starting in January 1987. Compare all filings or the consumer, business or corporate series. The corporate series is part of the business series.
- Calendar-year filing counts sum twelve observed months. Incomplete years and missing observations appear as gaps.
- Official annual rates cover provinces, economic regions, census metropolitan areas and business sectors. Consumer rates use residents aged 18 and older. Business rates use the number of businesses. Both are expressed per 1,000 of the applicable denominator.
- Published region and industry definitions may change. Workbook links in the app provide the agency's source data and footnotes.

## Sources

The Office of the Superintendent of Bankruptcy publishes the [historical monthly filing workbook](https://open.canada.ca/data/en/dataset/746709f1-c729-44a1-ba84-7be5eadd3664) and the [annual rate workbook](https://open.canada.ca/data/en/dataset/0e52f1b0-089a-430e-bbd1-1367d7328a2e) under the [Open Government Licence – Canada](https://open.canada.ca/en/open-government-licence-canada). See the [official rates and methodology](https://ised-isde.canada.ca/site/office-superintendent-bankruptcy/en/statistics-and-research/annual-insolvency-rates).

The build discovers the published workbooks through their federal catalogue records. It uses known official download links if discovery or a discovered download fails. Actual data coverage is displayed in the app.

## Run locally

```sh
python3 -m venv .venv
. .venv/bin/activate
python3 -m pip install -r requirements.txt
python3 scripts/build.py
python3 -m http.server --directory dist 8000
```

If you have downloaded the official workbooks locally, use `--counts-file` and `--rates-file` to build with them.

The GitHub Actions workflow builds the site on pushes to `main`, on a weekly schedule and on manual dispatch. Select **GitHub Actions** as the publishing source under Settings → Pages.
