#!/usr/bin/env python3
"""Build the static Insolvency Atlas from two OSB workbooks."""
import argparse
from datetime import date, datetime
import json
from math import isfinite
from pathlib import Path
import re
from shutil import copytree, rmtree
from tempfile import TemporaryDirectory
from urllib.parse import urlparse
from urllib.request import Request, urlopen

import openpyxl
import xlrd


ROOT = Path(__file__).resolve().parents[1]
CKAN = "https://open.canada.ca/data/api/3/action/package_show?id="
DOCUMENTS = "https://ised-isde.canada.ca/site/office-superintendent-bankruptcy/sites/default/files/documents/"
SOURCES = {
    "counts": ("746709f1-c729-44a1-ba84-7be5eadd3664", "historical_insolvency_statistics_monthly_sept_2026.xlsx"),
    "rates": ("0e52f1b0-089a-430e-bbd1-1367d7328a2e", "insolvency_rates_2025_en.xls"),
}
REGIONS = {
    "Canada": "CA", "Newfoundland and Labrador": "NL", "Prince Edward Island": "PE",
    "Nova Scotia": "NS", "New Brunswick": "NB", "Quebec": "QC", "Ontario": "ON",
    "Manitoba": "MB", "Saskatchewan": "SK", "Alberta": "AB", "British Columbia": "BC",
    "Yukon": "YT", "Northwest Territories": "NT", "Nunavut": "NU",
}
MEASURES = dict(zip(
    ("Insolvencies", "Bankruptcies", "Proposals"), ("insolvency", "bankruptcy", "proposal")
))
MONTHS = dict(zip("jan feb mar apr may jun jul aug sep oct nov dec".split(), range(1, 13)))
RATE_SHEETS = {
    "consumer-regions": ("ER - Consumer Insol. Rates", "regions"),
    "business-regions": ("ER - Business Insol. Rates", "regions"),
    "consumer-metros": ("CMA - Consumer Insol. Rates", "metros"),
    "business-metros": ("CMA - Business Insol. Rates", "metros"),
    "business-sectors": ("NAICS -Insolvency Rates", "sectors"),
}


def read_url(url, limit, timeout):
    request = Request(url, headers={"User-Agent": "CoolCode Insolvency Atlas data build"})
    with urlopen(request, timeout=timeout) as handle:
        payload = handle.read(limit + 1)
    if not payload or len(payload) > limit:
        raise ValueError("Source response is empty or too large")
    return payload


def recent_url(kind, dataset):
    resources = json.loads(read_url(CKAN + dataset, 2_000_000, 15))["result"]["resources"]
    for resource in resources:
        url = resource["url"]
        location = urlparse(url)
        if location.scheme != "https" or location.hostname != "ised-isde.canada.ca":
            continue
        pattern = (
            r"historical_insolvency_statistics_monthly_[^/]+\.xlsx$" if kind == "counts"
            else r"insolvency_rates_[^/]+_en\.xls$"
        )
        if re.search(pattern, location.path.lower()):
            return url
    raise ValueError("No matching workbook in official catalogue")


def workbook(kind, directory, local):
    dataset, filename = SOURCES[kind]
    fallback = DOCUMENTS + filename
    discovered = None
    if local is None:
        try:
            discovered = recent_url(kind, dataset)
        except (OSError, ValueError, KeyError) as error:
            print(f"{kind}: catalogue lookup unavailable ({error}); using pinned official download")
    urls = dict.fromkeys(filter(None, (discovered, fallback)))
    if local is None:
        target = directory / filename
        for url in urls:
            try:
                target.write_bytes(read_url(url, 10_000_000, 35))
                return target, source(dataset, url)
            except (OSError, ValueError) as error:
                print(f"{kind}: {url}: {error}")
        raise RuntimeError(f"Could not download {kind} workbook")
    return local, source(dataset, fallback)


def source(dataset, url):
    return {"dataset": f"https://open.canada.ca/data/en/dataset/{dataset}", "file": url}


def month_key(value):
    if isinstance(value, (date, datetime)):
        return value.strftime("%Y-%m")
    match = re.fullmatch(r"([A-Za-z]{3}).*?\s+(\d{4})", str(value).strip())
    if not match or match[1].lower() not in MONTHS:
        raise ValueError(f"Unrecognized month header: {value!r}")
    return f"{match[2]}-{MONTHS[match[1].lower()]:02d}"


def numeric(value, *, integer=False):
    if type(value) not in (int, float) or not isfinite(value) or value < 0:
        return None
    if integer and int(value) != value:
        raise ValueError(f"Expected a whole-number count, found {value!r}")
    return int(value) if integer else round(value, 6)


def unpack_counts(path):
    workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        rows = iter(workbook.worksheets[0].values)
        header = next(rows)
        columns = [(i, month_key(value)) for i, value in enumerate(header[2:], 2) if value is not None]
        months = [period for _, period in columns]
        values = {}
        current = None
        for row in rows:
            name, label = row[:2]
            if name:
                current = REGIONS.get(str(name).split("/", 1)[0].strip())
            if not current or not label:
                continue
            words = str(label).split("/", 1)[0].split()
            if len(words) != 2 or words[1] not in MEASURES:
                continue
            group = words[0].lower()
            if group not in ("total", "consumer", "business", "corporate"):
                continue
            key = f"{group}-{MEASURES[words[1]]}"
            data = values.setdefault(current, {})
            if key in data:
                raise ValueError(f"Duplicate series {current}/{key}")
            data[key] = [numeric(row[i], integer=True) for i, _ in columns]
    finally:
        workbook.close()
    if len(months) < 400 or months[0] != "1987-01" or months != sorted(set(months)):
        raise ValueError("Monthly workbook has unexpected date coverage")
    if set(values) != set(REGIONS.values()) or any(len(data) != 12 for data in values.values()):
        raise ValueError("Monthly workbook is missing expected filing series")
    return {"periods": months, "values": values}


def unpack_rate_sheet(book, sheet_name, scope):
    sheet = book.sheet_by_name(sheet_name)
    header = sheet.row_values(3)
    measure_col = 2 if scope == "metros" else 1
    first_year = 1998 if "Business" in sheet_name else 1987
    columns = [(i, str(int(value))) for i, value in enumerate(header[measure_col + 1 :], measure_col + 1)
               if isinstance(value, (int, float)) and first_year <= value <= 2100]
    periods = [year for _, year in columns]
    if len(periods) < 20 or periods != sorted(set(periods)):
        raise ValueError(f"Unexpected rate years for {sheet_name}")
    values = {}
    names = {}
    province = None
    current = None
    for row_num in range(4, sheet.nrows):
        row = sheet.row_values(row_num)
        measure = str(row[measure_col]).strip().lower()
        if measure not in MEASURES.values():
            continue
        if row[0]:
            name = str(row[0]).strip().rstrip("*").replace("\u00a0", " ")
            if scope == "regions":
                code = REGIONS.get("Yukon" if name == "Yukon Territory" else name)
                if code:
                    province = code
                    name = "Yukon" if name == "Yukon Territory" else name
                else:
                    name = f"{name} ({province})"
                current = code or name
            else:
                name = f"{name}, {row[1]}" if scope == "metros" else name
                current = name
            names[current] = name
        if current is None:
            raise ValueError(f"Rate without an area in {sheet_name}")
        data = values.setdefault(current, {})
        if measure in data:
            raise ValueError(f"Duplicate rate series {sheet_name}/{current}/{measure}")
        data[measure] = [numeric(row[i]) for i, _ in columns]
    if len(values) < 14 or any(len(data) != 3 for data in values.values()):
        raise ValueError(f"Rate series missing in {sheet_name}")
    return {"periods": periods, "values": values, "areas": names}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--counts-file", type=Path)
    parser.add_argument("--rates-file", type=Path)
    args = parser.parse_args()
    with TemporaryDirectory() as temporary:
        directory = Path(temporary)
        counts_path, counts_source = workbook("counts", directory, args.counts_file)
        rate_path, rate_source = workbook("rates", directory, args.rates_file)
        counts = unpack_counts(counts_path)
        ratebook = xlrd.open_workbook(rate_path)
        rates = {key: unpack_rate_sheet(ratebook, *config) for key, config in RATE_SHEETS.items()}
    snapshot = {
        "version": 1,
        "sources": {"counts": counts_source, "rates": rate_source},
        "counts": {**counts, "areas": {code: name for name, code in REGIONS.items()}},
        "rates": rates,
    }
    output = ROOT / "dist"
    stage = ROOT / ".dist-build"
    if stage.exists():
        rmtree(stage)
    copytree(ROOT / "web", stage)
    (stage / "snapshot.json").write_text(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    if output.exists():
        rmtree(output)
    stage.replace(output)
    print(f"Monthly counts through {counts['periods'][-1]} · {len(counts['values'])} areas")
    print(f"Annual rates through {rates['consumer-regions']['periods'][-1]} · {sum(len(s['areas']) for s in rates.values())} series groups")


if __name__ == "__main__":
    main()
