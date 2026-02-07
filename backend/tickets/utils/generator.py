import itertools
import random


def generate_housie_ticket():
    # Define column ranges as per Tambola rules.
    column_ranges = [
        (1, 9),
        (10, 19),
        (20, 29),
        (30, 39),
        (40, 49),
        (50, 59),
        (60, 69),
        (70, 79),
        (80, 90),
    ]

    # Step 1: decide how many numbers go in each column (total 15, max 3 per column).
    column_counts = [1] * 9
    remaining = 15 - sum(column_counts)
    while remaining > 0:
        col = random.randrange(9)
        if column_counts[col] < 3:
            column_counts[col] += 1
            remaining -= 1

    # Step 2: pick numbers for each column and sort them within the column.
    column_numbers = []
    for col_index, (start, end) in enumerate(column_ranges):
        count = column_counts[col_index]
        numbers = random.sample(range(start, end + 1), count)
        numbers.sort()
        column_numbers.append(numbers)

    # Step 3: assign which rows each column's numbers will occupy (5 numbers per row).
    columns = list(range(9))
    columns.sort(key=lambda c: column_counts[c], reverse=True)

    row_counts = [0, 0, 0]
    rows_for_column = [None] * 9

    def backtrack(col_idx):
        # All columns assigned; ensure each row has exactly 5 numbers.
        if col_idx == len(columns):
            return row_counts == [5, 5, 5]

        col = columns[col_idx]
        count = column_counts[col]

        for combo in itertools.combinations(range(3), count):
            if any(row_counts[r] + 1 > 5 for r in combo):
                continue

            for r in combo:
                row_counts[r] += 1
            rows_for_column[col] = combo

            remaining_counts = sum(column_counts[c] for c in columns[col_idx + 1 :])
            min_needed = sum(5 - rc for rc in row_counts)
            if min_needed <= remaining_counts and backtrack(col_idx + 1):
                return True

            for r in combo:
                row_counts[r] -= 1
            rows_for_column[col] = None

        return False

    if not backtrack(0):
        raise RuntimeError("Failed to generate a valid ticket layout.")

    # Step 4: build the 3x9 grid, filling None for empty cells.
    rows = [[None for _ in range(9)] for _ in range(3)]
    for col in range(9):
        row_slots = sorted(rows_for_column[col])
        for idx, row in enumerate(row_slots):
            rows[row][col] = column_numbers[col][idx]

    return {"rows": rows}
