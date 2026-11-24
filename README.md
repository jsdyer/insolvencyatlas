# Insolvency Atlas

<!-- coolcode:guide -->
Compare filings or official annual rates for selected regions, then export the same range as CSV. Incomplete years stay blank, and consumer and business rates use different denominators, so compare like measures.
<!-- /coolcode:guide -->

Compare Canadian insolvency filings and official annual rates in a static web app. The timeline, observation table and CSV all reflect the selected range, measure and comparison areas. The URL preserves the comparison.

The [cross-tool comparison](https://coolcode.ca/insolvencyatlas/compare.html) puts monthly consumer insolvencies, a selected grocery product and the Bank of Canada target overnight rate on the same calendar. The cards keep separate scales, report their geographic scopes and synchronize the inspected month. Policy rates use the last available business-day observation in each completed month. The chart and CSV preserve missing observations and actual policy-rate dates.

The comparison reads the published same-origin Price Atlas and BankRate Lab snapshots alongside Insolvency Atlas. From a local server, mount the other two projects at `/priceatlas/` and `/bankrates/` to try all three series.

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

<!-- schedule-reliability -->
## Schedule reliability

Public GitHub repositories can have scheduled workflows disabled after 60 days of inactivity. A separate weekly [schedule guard](.github/workflows/schedule-guard.yml) calls GitHub's enable-workflow API for an explicit list of refresh workflows and itself. It can restore workflows disabled for inactivity, preserves manually disabled workflows, and runs independently of collection failures.

This is an interim mitigation, not a scheduling guarantee: GitHub does not document active-workflow renewal as a permanent exemption, and scheduled runs can be delayed or dropped. A scheduler on our own Linux server is the planned independent trigger. The guard does not collect data, create dummy commits, or change source/check timestamps; successful collection and published data freshness still need monitoring.
<!-- /schedule-reliability -->
