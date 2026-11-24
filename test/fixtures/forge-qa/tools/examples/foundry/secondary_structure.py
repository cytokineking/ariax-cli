"""Inspect native NA geometry on the full mixed array with global token IDs."""
import numpy as np
from biotite.structure import AtomArray, get_residue_starts
from atomworks.ml.utils.token import get_token_starts, spread_token_wise
from rfd3na.transforms.util_transforms import assign_types_
from rfd3na.transforms.na_geom_utils import annotate_na_ss, parse_dot_bracket


def prepare(array: AtomArray, final: dict | None = None) -> AtomArray:
    array = assign_types_(array.copy())
    atomized = array.atomize if "atomize" in array.get_annotation_categories() else np.zeros(len(array), dtype=bool)
    array.set_annotation("atomize", np.asarray(atomized, dtype=bool) | array.is_ligand)
    array = assign_types_(array)
    # Retain atomized ligand tokens in the global map even though SS is residue-wise.
    starts = get_token_starts(array)
    token_ids = spread_token_wise(array, np.arange(len(starts)))
    if final and "token_id" in final.get("annotations", {}):
        a = final["annotations"]
        identities = list(zip(a["chain_id"], a["res_id"], a["res_name"], a["atom_name"]))
        if len(set(identities)) != len(identities):
            raise ValueError("Duplicate native output atom identity")
        mapping = dict(zip(identities, a["token_id"]))
        parsed = list(zip(array.chain_id, array.res_id, array.res_name, array.atom_name))
        if set(parsed) != set(mapping):
            raise ValueError("Native output token map differs from parsed atom identities")
        token_ids = np.asarray([mapping[key] for key in parsed], dtype=int)
    array.set_annotation("token_id", token_ids)
    array.set_annotation("chain_iid", array.chain_id.copy())
    return array


def pairs(array: AtomArray) -> list[tuple[int, int]]:
    return sorted({tuple(sorted((int(array.token_id[i]), int(partner))))
                   for i in get_residue_starts(array)
                   for partner in (array.bp_partners[i] or [])})


def inspect(array: AtomArray, dbn: str, native: dict, final: dict | None = None) -> dict:
    array = prepare(array, final)
    starts = get_residue_starts(array)
    rna_tokens = [int(array.token_id[i]) for i in starts if array.is_rna[i]]
    requested, loops = parse_dot_bracket(dbn)
    requested_tokens = sorted(tuple(sorted((rna_tokens[a], rna_tokens[b])))
                              for a, b in requested)
    unpaired_tokens = [rna_tokens[i] for i in loops]
    observed = annotate_na_ss(array, NA_only=True, p_canonical_bp_filter=0.0)
    observed_pairs = pairs(observed)
    ss = np.asarray(native["features"].get("bp_partners", []))
    return {
        "requested_rna_position_pairs_zero_based": requested,
        "requested_output_token_pairs": requested_tokens,
        "requested_pairs_present": all(p in observed_pairs for p in requested_tokens),
        "missing_requested_output_token_pairs": [p for p in requested_tokens if p not in observed_pairs],
        "unexpected_output_token_pairs": [p for p in observed_pairs if p not in requested_tokens],
        "requested_unpaired_positions_remain_unpaired": all(not any(i in p for p in observed_pairs) for i in unpaired_tokens),
        "requested_unpaired_rna_positions_zero_based": loops,
        "model_feature_shape": list(ss.shape),
        "model_pair_entries": np.argwhere(np.argmax(ss, axis=-1) == 1).tolist() if ss.ndim == 3 else [],
        "observed_native_geometry_token_pairs": observed_pairs,
        "global_token_mapping_source": "native final atom-token map" if final and "token_id" in final.get("annotations", {}) else "retained CIF order and native ligand atomization convention; original final map unavailable",
        "observed_token_identity": [[int(array.token_id[i]), str(array.chain_id[i]), int(array.res_id[i]), str(array.res_name[i])] for i in starts],
        "geometry_method": "native annotate_na_ss with real HBPLUS, planarity and relative-geometry filters",
        "analysis_chain_instances": "one instance per actual asym-unit author chain",
        "analysis_subset": "full mixed array with native eligible-base filtering",
        "excluded_non_RNA_atom_count": 0,
        "native_full_mixed_analysis_available": True,
        "output_geometry_inference_replay": False,
    }
