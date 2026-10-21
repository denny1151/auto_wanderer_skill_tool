"""Search valid 6x6 block layouts using lexicographic objectives."""

from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Any


BOARD_SIZE = 6
MAX_SEARCH_NODES = 300_000
MAIN_COLOR = "#F4B183"


class PuzzleInputError(ValueError):
    """Raised when the submitted puzzle configuration is invalid."""


@dataclass(frozen=True)
class ShapePlacement:
    mask: int
    cells: tuple[tuple[int, int], ...]


def _normalize(cells: set[tuple[int, int]]) -> tuple[tuple[int, int], ...]:
    top = min(row for row, _ in cells)
    left = min(col for _, col in cells)
    return tuple(sorted((row - top, col - left) for row, col in cells))


def _parse_shape(value: Any, label: str) -> tuple[tuple[int, int], ...]:
    if isinstance(value, str):
        rows = value.splitlines()
    elif isinstance(value, list) and all(isinstance(row, str) for row in value):
        rows = value
    else:
        raise PuzzleInputError(f"{label}：形狀請用 # 和 . 組成的多行文字。")

    rows = [row.replace(" ", "").strip() for row in rows if row.strip()]
    if not rows or any(set(row) - {"#", "."} for row in rows):
        raise PuzzleInputError(f"{label}：形狀只能使用 # 和 .，且至少要有一格 #。")

    cells = {(row, col) for row, line in enumerate(rows) for col, char in enumerate(line) if char == "#"}
    if not cells:
        raise PuzzleInputError(f"{label}：形狀至少要有一格 #。")

    seen = {next(iter(cells))}
    stack = list(seen)
    while stack:
        row, col = stack.pop()
        for neighbor in ((row - 1, col), (row + 1, col), (row, col - 1), (row, col + 1)):
            if neighbor in cells and neighbor not in seen:
                seen.add(neighbor)
                stack.append(neighbor)
    if len(seen) != len(cells):
        raise PuzzleInputError(f"{label}：技能格必須上下左右相連。")
    if len(cells) > BOARD_SIZE * BOARD_SIZE:
        raise PuzzleInputError(f"{label}：技能形狀超過棋盤 36 格。")
    return _normalize(cells)


def _rotations(shape: tuple[tuple[int, int], ...]) -> tuple[tuple[tuple[int, int], ...], ...]:
    orientations = set()
    for turns in range(4):
        cells = set(shape)
        for _ in range(turns):
            cells = {(col, -row) for row, col in cells}
        orientations.add(_normalize(cells))
    return tuple(sorted(orientations))


def _placements(shape: tuple[tuple[int, int], ...]) -> tuple[ShapePlacement, ...]:
    placements = {}
    for orientation in _rotations(shape):
        height = max(row for row, _ in orientation) + 1
        width = max(col for _, col in orientation) + 1
        for top in range(BOARD_SIZE - height + 1):
            for left in range(BOARD_SIZE - width + 1):
                cells = tuple(sorted((top + row, left + col) for row, col in orientation))
                mask = sum(1 << (row * BOARD_SIZE + col) for row, col in cells)
                placements[mask] = ShapePlacement(mask, cells)
    return tuple(placements.values())


def _neighbor_mask(mask: int) -> int:
    neighbors = 0
    for index in range(BOARD_SIZE * BOARD_SIZE):
        if not (mask >> index) & 1:
            continue
        row, col = divmod(index, BOARD_SIZE)
        for neighbor in (
            (row - 1, col),
            (row + 1, col),
            (row, col - 1),
            (row, col + 1),
        ):
            nr, nc = neighbor
            if 0 <= nr < BOARD_SIZE and 0 <= nc < BOARD_SIZE:
                neighbors |= 1 << (nr * BOARD_SIZE + nc)
    return neighbors & ~mask


def _blank_stats(occupied_mask: int) -> tuple[int, int, int]:
    board_mask = (1 << (BOARD_SIZE * BOARD_SIZE)) - 1
    empty = board_mask & ~occupied_mask
    component_sizes = []
    remaining = empty
    while remaining:
        start = remaining & -remaining
        component = start
        frontier = start
        while frontier:
            next_frontier = 0
            bits = frontier
            while bits:
                bit = bits & -bits
                bits ^= bit
                next_frontier |= _neighbor_mask(bit)
            next_frontier &= empty & ~component
            component |= next_frontier
            frontier = next_frontier
        size = component.bit_count()
        component_sizes.append(size)
        remaining &= ~component
    component_count = len(component_sizes)
    is_connected = component_count <= 1
    largest = max(component_sizes, default=0)
    return int(is_connected), largest, -component_count


def _count(mask: int) -> int:
    return mask.bit_count()


def _validate_config(config: Any) -> tuple[list[dict], list[dict]]:
    if not isinstance(config, dict):
        raise PuzzleInputError("設定格式錯誤。")
    main_rows = config.get("mainPieces")
    groups = config.get("groups")
    if not isinstance(main_rows, list) or not main_rows:
        raise PuzzleInputError("至少建立一種主動技能。")
    if not isinstance(groups, list) or not groups:
        raise PuzzleInputError("至少建立一組輔助技能。")
    if len(main_rows) > 30 or len(groups) > 12:
        raise PuzzleInputError("主動技能最多 30 種，輔助技能最多 12 組。")

    main_pieces = []
    for index, item in enumerate(main_rows, 1):
        if not isinstance(item, dict):
            raise PuzzleInputError(f"主動技能 {index} 設定格式錯誤。")
        name = str(item.get("name") or f"主動技能 {index}").strip()
        stock = _positive_int(item.get("stock", 1), f"{name} 數量", allow_zero=True)
        shape = _parse_shape(item.get("shape"), name)
        main_pieces.append({"name": name, "stock": stock, "shape": shape})
    if not any(piece["stock"] for piece in main_pieces):
        raise PuzzleInputError("至少一種主動技能的可用數量要大於 0。")

    normalized_groups = []
    for group_index, group in enumerate(groups, 1):
        if not isinstance(group, dict):
            raise PuzzleInputError(f"輔助技能第 {group_index} 組設定格式錯誤。")
        name = str(group.get("name") or f"輔助技能 {group_index}").strip()
        pieces = group.get("pieces")
        if not isinstance(pieces, list) or not pieces:
            raise PuzzleInputError(f"{name}：至少建立一種形狀。")
        variants = []
        for piece_index, piece in enumerate(pieces, 1):
            if not isinstance(piece, dict):
                raise PuzzleInputError(f"{name} 的形狀 {piece_index} 設定格式錯誤。")
            piece_name = str(piece.get("name") or f"形狀 {piece_index}").strip()
            stock = _positive_int(piece.get("stock", 1), f"{name}／{piece_name} 數量", allow_zero=True)
            variants.append({
                "name": piece_name,
                "stock": stock,
                "shape": _parse_shape(piece.get("shape"), f"{name}／{piece_name}"),
            })
        available = sum(piece["stock"] for piece in variants)
        minimum = _positive_int(group.get("min", 0), f"{name} 最少數量", allow_zero=True)
        raw_maximum = group.get("max")
        maximum = available if raw_maximum in (None, "") else _positive_int(raw_maximum, f"{name} 最多數量", allow_zero=True)
        if minimum > maximum:
            raise PuzzleInputError(f"{name}：最少數量不能大於最多數量。")
        if minimum > available:
            raise PuzzleInputError(f"{name}：最少數量大於可用庫存 {available}。")
        color = str(group.get("color") or "#4B8CCB")
        if not re.fullmatch(r"#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?", color):
            raise PuzzleInputError(f"{name}：顏色格式錯誤。")
        normalized_groups.append({
            "name": name,
            "min": minimum,
            "max": min(maximum, available),
            "preferMore": bool(group.get("preferMore")),
            "color": color,
            "pieces": variants,
            "available": available,
        })
    return main_pieces, normalized_groups


def _positive_int(value: Any, label: str, allow_zero: bool = False) -> int:
    if isinstance(value, bool):
        raise PuzzleInputError(f"{label}請填整數。")
    try:
        result = int(value)
    except (TypeError, ValueError):
        raise PuzzleInputError(f"{label}請填整數。") from None
    if isinstance(value, float) and not value.is_integer():
        raise PuzzleInputError(f"{label}請填整數。")
    if isinstance(value, str) and str(result) != value.strip():
        raise PuzzleInputError(f"{label}請填整數。")
    if result < (0 if allow_zero else 1) or result > 10_000:
        minimum = "0" if allow_zero else "1"
        raise PuzzleInputError(f"{label}請填 {minimum} 到 10000 的整數。")
    return result


def solve(config: Any, max_nodes: int = MAX_SEARCH_NODES) -> dict:
    main_pieces, groups = _validate_config(config)
    group_limits = [(group["min"], group["max"]) for group in groups]
    preferred_groups = [index for index, group in enumerate(groups) if group["preferMore"]]
    preferred_order = {group_index: order for order, group_index in enumerate(preferred_groups)}
    types = []
    for group_index, group in enumerate(groups):
        for piece in group["pieces"]:
            types.append({
                "groupIndex": group_index,
                "groupName": group["name"],
                "name": piece["name"],
                "shape": piece["shape"],
                "stock": piece["stock"],
                "area": len(piece["shape"]),
                "color": group["color"],
                "placements": _placements(piece["shape"]),
            })
    type_indices_by_group = [[] for _ in groups]
    for type_index, piece_type in enumerate(types):
        type_indices_by_group[piece_type["groupIndex"]].append(type_index)
    type_indices_by_group_by_area = [
        sorted(indices, key=lambda index: types[index]["area"])
        for indices in type_indices_by_group
    ]

    best_score = None
    best_solution = None
    nodes = 0
    stopped = False
    board_mask = (1 << (BOARD_SIZE * BOARD_SIZE)) - 1
    main_candidates = []
    seen_main_masks = set()
    for main in main_pieces:
        if not main["stock"]:
            continue
        for placement in _placements(main["shape"]):
            if placement.mask in seen_main_masks:
                continue
            seen_main_masks.add(placement.mask)
            main_candidates.append((main, placement))

    def consider(main: dict, main_placement: ShapePlacement, chosen: list[dict], occupied: int, counts: list[int]) -> None:
        nonlocal best_score, best_solution
        if any(counts[index] < minimum or counts[index] > maximum
               for index, (minimum, maximum) in enumerate(group_limits)):
            return
        blanks = 36 - _count(occupied)
        connectivity = _blank_stats(occupied)
        preferred_counts = tuple(counts[index] for index in preferred_groups)
        score = (preferred_counts, blanks, *connectivity)
        if best_score is not None and score <= best_score:
            return
        placements = [{
            "kind": "main",
            "group": "主動技能",
            "pieceName": main["name"],
            "color": MAIN_COLOR,
            "cells": [[row + 1, col + 1] for row, col in main_placement.cells],
        }]
        for type_index, placement in chosen:
            piece_type = types[type_index]
            placements.append({
                "kind": "secondary",
                "group": piece_type["groupName"],
                "pieceName": piece_type["name"],
                "color": piece_type["color"],
                "cells": [[row + 1, col + 1] for row, col in placement.cells],
            })
        best_score = score
        best_solution = {
            "placements": placements,
            "selectedCounts": {group["name"]: counts[index] for index, group in enumerate(groups)},
            "preferredCounts": {groups[index]["name"]: counts[index] for index in preferred_groups},
            "emptyCells": blanks,
            "emptyConnected": bool(connectivity[0]),
            "emptyComponents": -connectivity[2],
            "largestEmptyComponent": connectivity[1],
            "mainPiece": main["name"],
        }

    for main, main_placement in main_candidates:
        if stopped:
            break
        main_mask = main_placement.mask
        border_mask = _neighbor_mask(main_mask) & board_mask
        if not border_mask:
            continue
        candidate_maps = []
        for piece_type in types:
            by_anchor = {}
            for placement in piece_type["placements"]:
                border_cells = placement.mask & border_mask
                if not border_cells:
                    continue
                bits = border_cells
                while bits:
                    bit = bits & -bits
                    bits ^= bit
                    by_anchor.setdefault(bit, []).append((placement, border_cells))
            candidate_maps.append(by_anchor)

        counts = [0] * len(groups)
        remaining_stock = [piece_type["stock"] for piece_type in types]
        remaining_by_group = [sum(types[index]["stock"] for index in indices)
                              for indices in type_indices_by_group]

        def dfs(occupied: int, covered: int, blocked: int, chosen: list[tuple[int, ShapePlacement]]) -> None:
            nonlocal nodes, stopped
            if stopped:
                return
            nodes += 1
            if nodes > max_nodes:
                stopped = True
                return

            processed = covered | blocked
            unprocessed = border_mask & ~processed
            for group_index, (minimum, maximum) in enumerate(group_limits):
                available = remaining_by_group[group_index]
                if counts[group_index] > maximum or counts[group_index] + available < minimum:
                    return
                if counts[group_index] + min(available, _count(unprocessed)) < minimum:
                    return

            if best_score is not None:
                current_preferred_upper = []
                for group_index in preferred_groups:
                    free_area = 36 - _count(occupied)
                    area_limited_count = 0
                    for type_index in type_indices_by_group_by_area[group_index]:
                        piece_area = types[type_index]["area"]
                        selected = min(remaining_stock[type_index], free_area // piece_area)
                        area_limited_count += selected
                        free_area -= selected * piece_area
                    current_preferred_upper.append(min(
                        group_limits[group_index][1],
                        counts[group_index] + remaining_by_group[group_index],
                        counts[group_index] + _count(unprocessed),
                        counts[group_index] + area_limited_count,
                    ))
                upper_tuple = tuple(current_preferred_upper)
                if upper_tuple < best_score[0]:
                    return
                if upper_tuple == best_score[0]:
                    required_area = 0
                    impossible = False
                    for group_index, (minimum, _) in enumerate(group_limits):
                        target_count = minimum
                        if group_index in preferred_groups:
                            target_count = max(target_count, best_score[0][preferred_groups.index(group_index)])
                        needed = max(0, target_count - counts[group_index])
                        if not needed:
                            continue
                        for type_index in type_indices_by_group_by_area[group_index]:
                            selected = min(needed, remaining_stock[type_index])
                            required_area += selected * types[type_index]["area"]
                            needed -= selected
                            if not needed:
                                break
                        if needed:
                            impossible = True
                            break
                    if impossible or 36 - _count(occupied) - required_area < best_score[1]:
                        return

            if not unprocessed:
                consider(main, main_placement, chosen, occupied, counts)
                return

            anchor = unprocessed & -unprocessed
            options = []
            for type_index, piece_type in enumerate(types):
                group_index = piece_type["groupIndex"]
                if not remaining_stock[type_index] or counts[group_index] >= group_limits[group_index][1]:
                    continue
                for placement, border_cells in candidate_maps[type_index].get(anchor, ()):
                    if border_cells & processed or placement.mask & occupied:
                        continue
                    options.append((type_index, placement, border_cells))
            options.sort(key=lambda option: (
                0 if groups[types[option[0]]["groupIndex"]]["preferMore"] else 1,
                preferred_order.get(types[option[0]]["groupIndex"], types[option[0]]["groupIndex"]),
                types[option[0]]["area"] if groups[types[option[0]]["groupIndex"]]["preferMore"] else -types[option[0]]["area"],
                option[0],
                option[1].mask,
            ))

            for type_index, placement, border_cells in options:
                if stopped:
                    return
                group_index = types[type_index]["groupIndex"]
                remaining_stock[type_index] -= 1
                remaining_by_group[group_index] -= 1
                counts[group_index] += 1
                chosen.append((type_index, placement))
                dfs(occupied | placement.mask, covered | border_cells, blocked, chosen)
                chosen.pop()
                counts[group_index] -= 1
                remaining_by_group[group_index] += 1
                remaining_stock[type_index] += 1

            if not stopped:
                dfs(occupied, covered, blocked | anchor, chosen)

        dfs(main_mask, 0, 0, [])

    if best_solution is None:
        if stopped:
            return {
                "status": "limit",
                "nodes": nodes,
                "message": "搜尋達到節點上限，尚未找到符合全部規則的排列。可簡化形狀或降低庫存數量後再試。",
            }
        return {
            "status": "infeasible",
            "nodes": nodes,
            "message": "目前主動技能、輔助技能庫存與規則無法同時放進 6×6 棋盤。可降低最低數量、增加庫存或調整形狀。",
        }

    return {
        "status": "partial" if stopped else "optimal",
        "nodes": nodes,
        "message": "已找到目前最佳排列。搜尋達到節點上限，結果可能還有更好的排列。" if stopped else "已搜尋完成，找到符合規則的最佳排列。",
        "solution": best_solution,
    }
