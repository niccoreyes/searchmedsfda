#!/usr/bin/env python3

import csv
import sys

HEADERS = [
    "Product Information",
    "Registration Number",
    "Generic Name",
    "Brand Name",
    "Dosage Strength",
    "Dosage Form",
    "Classification",
    "Packaging",
    "Pharmacologic Category",
    "Manufacturer",
    "Country of Origin",
    "Trader",
    "Importer",
    "Distributor",
    "Application Type",
    "Issuance Date",
    "Expiry Date",
]


def is_valid_reg_number(reg):
    """Check if registration number is valid."""
    if not reg or reg.strip() == "" or reg.strip() == "-":
        return False

    trimmed = reg.strip()

    # Skip timestamp-like numbers (14 digits starting with 20)
    if len(trimmed) == 14 and trimmed.startswith("20") and trimmed.isdigit():
        return False

    # Skip if it looks like a field content that slipped into wrong column
    invalid_patterns = [
        "Antibacterial",
        "Antineoplastic",
        "Vitamin",
        "Prescription",
        "Over-the-Counter",
        "Capsule",
        "Tablet",
        "Syrup",
        "Film-Coated",
        "Renewal",
        "Initial",
        "Vaccine",
        "Anticoagulant",
    ]
    for pattern in invalid_patterns:
        if pattern.lower() in trimmed.lower() and len(trimmed) > 20:
            return False

    return True


def read_csv_file(filename):
    """Read CSV file and return list of rows."""
    rows = []
    with open(filename, "r", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        for row in reader:
            rows.append(row)
    return rows


def escape_csv_field(field):
    """Escape a field for CSV output."""
    if field is None:
        return ""
    field = str(field)
    if '"' in field or "," in field or "\n" in field or "\r" in field:
        return '"' + field.replace('"', '""') + '"'
    return field


def row_to_csv(row):
    """Convert row array to CSV string."""
    return ",".join(escape_csv_field(field) for field in row)


def main():
    print("Reading master file: ALL_DrugProducts.csv")
    master_rows = read_csv_file("ALL_DrugProducts.csv")
    print(f"  Loaded {len(master_rows)} rows from master file")

    print("\nReading harvested file: fda_harvested_products.csv")
    harvested_rows = read_csv_file("fda_harvested_products.csv")
    print(f"  Loaded {len(harvested_rows)} rows from harvested file")

    # Create map of existing products by registration number
    product_map = {}
    master_invalid = 0
    master_valid = 0

    for i, row in enumerate(master_rows):
        if i == 0:  # Skip header
            continue
        if len(row) >= 17:
            reg_number = row[1].strip() if row[1] else ""
            if is_valid_reg_number(reg_number):
                product_map[reg_number] = row
                master_valid += 1
            else:
                master_invalid += 1

    initial_count = len(product_map)
    print(f"  Valid master products: {master_valid} (invalid: {master_invalid})")

    # Merge harvested products
    updated_count = 0
    added_count = 0
    harvested_invalid = 0
    harvested_valid = 0

    for i, row in enumerate(harvested_rows):
        if i == 0:  # Skip header
            continue
        if len(row) >= 17:
            reg_number = row[1].strip() if row[1] else ""
            if is_valid_reg_number(reg_number):
                harvested_valid += 1
                if reg_number in product_map:
                    # Merge: keep master's Product Info if harvested's is empty
                    if (not row[0] or row[0].strip() == "") and product_map[reg_number][0]:
                        row[0] = product_map[reg_number][0]
                    product_map[reg_number] = row
                    updated_count += 1
                else:
                    product_map[reg_number] = row
                    added_count += 1
            else:
                harvested_invalid += 1

    print(f"  Valid harvested: {harvested_valid} (invalid: {harvested_invalid})")

    print("\n--- Merge Summary ---")
    print(f"Master file rows:          {len(master_rows) - 1}")
    print(f"Harvested file rows:       {len(harvested_rows) - 1}")
    print(f"Unique registration nums:  {initial_count}")
    print(f"Updated (overwritten):     {updated_count}")
    print(f"Newly added:               {added_count}")
    print(f"Final total:               {len(product_map)}")

    # Write combined file
    all_products = list(product_map.values())

    # Sort by registration number (column 1) for consistency
    all_products.sort(key=lambda x: x[1] if len(x) > 1 else "")

    with open("Combined_All_CPR.csv", "w", encoding="utf-8", newline="") as f:
        f.write(",".join(HEADERS) + "\n")
        for row in all_products:
            # Ensure row has exactly 17 columns
            while len(row) < 17:
                row.append("")
            f.write(row_to_csv(row[:17]) + "\n")

    print("\n✓ Created Combined_All_CPR.csv successfully!")


if __name__ == "__main__":
    main()
