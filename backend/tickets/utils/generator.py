import random

ROW_COMBINATIONS_BY_COUNT = {
    1: [(0,), (1,), (2,)],
    2: [(0, 1), (0, 2), (1, 2)],
    3: [(0, 1, 2)],
}
MAX_LAYOUT_ATTEMPTS = 80


def _generate_column_counts():
    """
    Build per-column counts (1..3) summing to 15.
    """
    counts = [1] * 9
    remaining = 15 - sum(counts)
    while remaining > 0:
        candidates = [index for index, value in enumerate(counts) if value < 3]
        selected = random.choice(candidates)
        counts[selected] += 1
        remaining -= 1
    return counts


def _shuffled_columns_for_assignment(column_counts):
    """
    Keep harder columns first (3, then 2, then 1), but shuffle inside each group
    to avoid repeated structures.
    """
    grouped = {1: [], 2: [], 3: []}
    for col_index, count in enumerate(column_counts):
        grouped[count].append(col_index)

    ordered = []
    for count in (3, 2, 1):
        bucket = grouped[count]
        random.shuffle(bucket)
        ordered.extend(bucket)
    return ordered


def _build_rows_for_column(column_counts):
    columns = _shuffled_columns_for_assignment(column_counts)
    row_counts = [0, 0, 0]
    rows_for_column = [None] * 9

    def backtrack(col_idx):
        if col_idx == len(columns):
            return row_counts == [5, 5, 5]

        col = columns[col_idx]
        count = column_counts[col]
        combos = list(ROW_COMBINATIONS_BY_COUNT[count])
        random.shuffle(combos)
        remaining_columns = len(columns) - col_idx - 1

        for combo in combos:
            if any(row_counts[row] >= 5 for row in combo):
                continue

            for row in combo:
                row_counts[row] += 1

            # Prune if any row cannot reach 5 with the remaining columns.
            if any((5 - row_counts[row]) > remaining_columns for row in range(3)):
                for row in combo:
                    row_counts[row] -= 1
                continue

            rows_for_column[col] = combo
            if backtrack(col_idx + 1):
                return True

            rows_for_column[col] = None
            for row in combo:
                row_counts[row] -= 1

        return False

    if not backtrack(0):
        return None
    return rows_for_column


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

    for _ in range(MAX_LAYOUT_ATTEMPTS):
        # Step 1: decide how many numbers go in each column (total 15, max 3 per column).
        column_counts = _generate_column_counts()

        # Step 2: assign which rows each column's numbers will occupy (5 numbers per row).
        rows_for_column = _build_rows_for_column(column_counts)
        if rows_for_column is None:
            continue

        # Step 3: pick numbers for each column and sort them within the column.
        column_numbers = []
        for col_index, (start, end) in enumerate(column_ranges):
            count = column_counts[col_index]
            numbers = random.sample(range(start, end + 1), count)
            numbers.sort()
            column_numbers.append(numbers)

        # Step 4: build the 3x9 grid, filling None for empty cells.
        rows = [[None for _ in range(9)] for _ in range(3)]
        for col in range(9):
            row_slots = sorted(rows_for_column[col])
            for idx, row in enumerate(row_slots):
                rows[row][col] = column_numbers[col][idx]

        return {"rows": rows}

    raise RuntimeError("Failed to generate a valid ticket layout.")
