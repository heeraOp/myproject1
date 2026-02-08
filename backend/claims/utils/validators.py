"""
Tambola (Housie) claim validators.

Inputs:
    - ticket_data: dict with "rows" key holding a 3x9 grid (ints or None).
    - called_numbers: set[int] of numbers called so far.

All validators return True/False only and avoid any Django/model dependencies.
"""


# Most common "Quick N" in Tambola is Quick 7. Change if your rules differ.
_QUICK_N_DEFAULT = 7


def _get_rows(ticket_data):
    """Safely extract rows from ticket_data."""
    if not isinstance(ticket_data, dict):
        return []
    rows = ticket_data.get("rows") or []
    return rows if isinstance(rows, list) else []


def _row_numbers(row):
    """Return the list of numbers in a row (ignoring empty cells)."""
    return [n for n in row if n is not None]


def _ticket_numbers(rows):
    """Flatten all numbers in the ticket into a list."""
    numbers = []
    for row in rows:
        if isinstance(row, list):
            numbers.extend(_row_numbers(row))
    return numbers


def _count_called(numbers, called_set):
    """Count how many numbers from the list are present in called_set."""
    return sum(1 for n in numbers if n in called_set)


def _is_row_complete(row_numbers, called_set):
    """True if every number in the row has been called."""
    return bool(row_numbers) and all(n in called_set for n in row_numbers)


def validate_early_5(ticket_data, called_numbers):
    """
    Early 5: Any 5 numbers on the ticket have been called.
    """
    called_set = set(called_numbers)
    rows = _get_rows(ticket_data)
    return _count_called(_ticket_numbers(rows), called_set) >= 5


def validate_quick_n(ticket_data, called_numbers):
    """
    Quick N: Any N numbers on the ticket have been called.

    By default uses Quick 7 (the most common Quick-N claim).
    """
    called_set = set(called_numbers)
    rows = _get_rows(ticket_data)
    return _count_called(_ticket_numbers(rows), called_set) >= _QUICK_N_DEFAULT


def validate_line(ticket_data, called_numbers):
    """
    Line: Any one complete horizontal line (row).
    """
    called_set = set(called_numbers)
    rows = _get_rows(ticket_data)
    for row in rows:
        if isinstance(row, list) and _is_row_complete(_row_numbers(row), called_set):
            return True
    return False


def validate_full_house(ticket_data, called_numbers):
    """
    Full House: All numbers on the ticket have been called.
    """
    called_set = set(called_numbers)
    rows = _get_rows(ticket_data)
    ticket_numbers = _ticket_numbers(rows)
    return bool(ticket_numbers) and all(n in called_set for n in ticket_numbers)


def validate_half_sheet(ticket_data, called_numbers):
    """
    Half Sheet (a.k.a. Two Lines / Half House): Any two complete rows.
    """
    called_set = set(called_numbers)
    rows = _get_rows(ticket_data)
    complete_rows = 0
    for row in rows:
        if isinstance(row, list) and _is_row_complete(_row_numbers(row), called_set):
            complete_rows += 1
    return complete_rows >= 2


def validate_box(ticket_data, called_numbers):
    """
    Box: At least two numbers called in each row (total 6 numbers).
    """
    called_set = set(called_numbers)
    rows = _get_rows(ticket_data)
    if len(rows) < 3:
        return False

    for row in rows[:3]:
        if not isinstance(row, list):
            return False
        row_numbers = _row_numbers(row)
        if _count_called(row_numbers, called_set) < 2:
            return False
    return True


def validate_corners(ticket_data, called_numbers):
    """
    Corners: First and last numbers of the top and bottom rows.
    """
    called_set = set(called_numbers)
    rows = _get_rows(ticket_data)
    if len(rows) < 3:
        return False

    top_numbers = _row_numbers(rows[0]) if isinstance(rows[0], list) else []
    bottom_numbers = _row_numbers(rows[2]) if isinstance(rows[2], list) else []

    if len(top_numbers) < 2 or len(bottom_numbers) < 2:
        return False

    corners = {
        top_numbers[0],
        top_numbers[-1],
        bottom_numbers[0],
        bottom_numbers[-1],
    }
    return all(n in called_set for n in corners)


def validate_star(ticket_data, called_numbers):
    """
    Star: Four corners + the middle number of the middle row.
    """
    called_set = set(called_numbers)
    rows = _get_rows(ticket_data)
    if len(rows) < 3:
        return False

    middle_row = rows[1] if isinstance(rows[1], list) else []
    middle_numbers = _row_numbers(middle_row)
    if len(middle_numbers) < 3:
        return False

    if not validate_corners(ticket_data, called_set):
        return False

    middle_number = middle_numbers[2]  # 3rd number in the middle row
    return middle_number in called_set
