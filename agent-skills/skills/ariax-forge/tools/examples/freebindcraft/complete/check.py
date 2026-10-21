"""Verify saved FreeBindCraft native atom37 exports at their original precision."""

import argparse, json, csv
from pathlib import Path
import gemmi
import numpy as np
from colabdesign.af.alphafold.common import residue_constants as rc

p = argparse.ArgumentParser(description=__doc__)
p.add_argument("directory")
p.add_argument("--diagnostic", action="store_true")
a = p.parse_args()
root = Path(a.directory)
target_path = Path("/inputs/freebindcraft/PDL1.pdb")
target_sequence = "".join(
    gemmi.find_tabulated_residue(r.name).one_letter_code
    for r in gemmi.read_structure(str(target_path))[0]["A"]
)
sequences = {}
for table in root.glob("*.csv"):
    with table.open(newline="") as stream:
        for row in csv.DictReader(stream):
            if row.get("Design") and row.get("Sequence"):
                sequences[row["Design"]] = row["Sequence"]
NATIVE_FIELDS = {
    "aatype",
    "residue_index",
    "atom_positions",
    "atom_mask",
    "plddt",
    "pae",
    "ptm",
    "i_ptm",
    "cmap",
    "i_cmap",
    "loss",
    "num_recycles",
    "seq_pseudo",
}
reports = []
for archive in sorted(root.glob("**/NativeArrays/*.native.npz")):
    metadata = json.loads(archive.with_suffix(".json").read_text())
    structure = gemmi.read_structure(str(archive.with_suffix(".pdb")))
    with np.load(archive, allow_pickle=False) as stream:
        values = {k: stream[k] for k in stream.files}
    assert (
        set(values) == set(metadata["arrays"]) == NATIVE_FIELDS
    ), "Incomplete native AF2 fields"
    m, n = values["aatype"].shape
    expected_shapes = {
        "aatype": (m, n),
        "residue_index": (m, n),
        "atom_positions": (m, n, 37, 3),
        "atom_mask": (m, n, 37),
        "plddt": (m, n),
        "pae": (m, n, n),
        "ptm": (m,),
        "i_ptm": (m,),
        "cmap": (m, n, n),
        "i_cmap": (m, n, n),
        "loss": (m,),
        "num_recycles": (m,),
        "seq_pseudo": (m, 1, metadata["native_lengths"][-1], 20),
    }
    for field, shape in expected_shapes.items():
        assert values[field].shape == shape, (field, values[field].shape, shape)
        assert values[field].dtype == np.dtype(
            "int32"
            if field in {"aatype", "residue_index"}
            else "int64" if field == "num_recycles" else "float32"
        ), (field, "native dtype")
    xyz, mask, plddt, aatype = [
        values[k] for k in ["atom_positions", "atom_mask", "plddt", "aatype"]
    ]
    assert xyz.shape[-2:] == (37, 3) and len(structure) == xyz.shape[0] == len(
        metadata["models"]
    )
    assert metadata["atom_axis"] == list(rc.atom_types)
    assert np.isfinite(plddt).all() and plddt.min() >= 0 and plddt.max() <= 1
    assert np.isfinite(values["pae"]).all() and values["pae"].min() >= 0
    coordinate_error = confidence_error = 0.0
    chain_sequences = []
    count = 0
    for k, info in metadata["arrays"].items():
        assert (
            list(values[k].shape) == info["shape"]
            and str(values[k].dtype) == info["dtype"]
        )
    for m, model in enumerate(structure):
        residues = [(chain.name, r) for chain in model for r in chain]
        assert len(residues) == xyz.shape[1] == sum(metadata["native_lengths"])
        assert [
            {
                "chain": c,
                "residue_number": r.seqid.num,
                "insertion_code": r.seqid.icode.strip(),
                "residue_name": r.name,
            }
            for c, r in residues
        ] == metadata["pdb_residue_axes"][m]
        for i, (_, residue) in enumerate(residues):
            assert residue.name == rc.restype_1to3[rc.restypes[int(aatype[m, i])]]
            assert {atom.name for atom in residue} == {
                rc.atom_types[j] for j in np.flatnonzero(mask[m, i] >= 0.5)
            }
            for atom in residue:
                j = rc.atom_order[atom.name]
                expected = xyz[m, i, j]
                assert np.isfinite(expected).all()
                difference = float(
                    np.max(
                        np.abs(
                            np.array([atom.pos.x, atom.pos.y, atom.pos.z]) - expected
                        )
                    )
                )
                confidence = abs(atom.b_iso - 100 * mask[m, i, j] * plddt[m, i])
                assert difference <= 0.000501 and confidence <= 0.00501
                coordinate_error = max(coordinate_error, difference)
                confidence_error = max(confidence_error, confidence)
                count += 1
        chain_sequences.append(
            {
                chain.name: "".join(
                    gemmi.find_tabulated_residue(r.name).one_letter_code for r in chain
                )
                for chain in model
            }
        )
    design = metadata["structure"].removesuffix(".pdb")
    if "_model" in design:
        design = design.rsplit("_model", 1)[0]
    for chains in chain_sequences:
        if len(metadata["native_lengths"]) == 2:
            assert chains["A"] == target_sequence
            binder_sequence = chains["B"]
        else:
            binder_sequence = "".join(chains.values())
        if design in sequences:
            assert binder_sequence == sequences[design]
    reports.append(
        {
            "archive": str(archive.relative_to(root)),
            "models": metadata["models"],
            "native_lengths": metadata["native_lengths"],
            "atoms": count,
            "max_coordinate_error_angstrom": coordinate_error,
            "max_bfactor_error": confidence_error,
            "sequences": chain_sequences,
            "iptm_finite": bool(np.isfinite(values["i_ptm"]).all()),
        }
    )
assert reports, "No complete native arrays"
for path in root.glob("**/*.fasta"):
    data = [
        line.strip()
        for line in path.read_text().splitlines()
        if line.strip() and not line.startswith(">")
    ]
    assert len(data) == 1 and data[0] == sequences[path.stem]

mpnn_reports = []
from colabdesign.mpnn import mk_mpnn_model

INPUT_FIELDS = {
    "X",
    "mask",
    "S",
    "residue_idx",
    "chain_idx",
    "lengths",
    "bias",
    "fix_pos",
}
OUTPUT_FIELDS = {"S", "decoding_order", "logits", "score", "seq", "seqid"}
for archive in sorted(root.glob("**/NativeMPNN/*.mpnn.npz")):
    metadata = json.loads(archive.with_suffix(".json").read_text())
    with np.load(archive, allow_pickle=False) as saved:
        values = {key: saved[key] for key in saved.files}
    expected_fields = {"inputs/" + key for key in INPUT_FIELDS} | {
        "outputs/" + key for key in OUTPUT_FIELDS
    }
    assert (
        set(values) == set(metadata["arrays"]) == expected_fields
    ), "Incomplete native MPNN fields"
    assert (
        metadata["unavailable"] == {}
    ), "These native profiles have no unavailable MPNN fields"
    for key, info in metadata["arrays"].items():
        assert list(values[key].shape) == info["shape"]
        assert str(values[key].dtype) == info["dtype"]
    inputs = {
        key[7:]: value for key, value in values.items() if key.startswith("inputs/")
    }
    outputs = {
        key[8:]: value for key, value in values.items() if key.startswith("outputs/")
    }
    native = mk_mpnn_model(
        model_name=metadata["checkpoint"],
        weights=metadata["weights"],
        backbone_noise=metadata["backbone_noise"],
    )
    trajectory = archive.parent.parent / metadata["trajectory"]
    assert trajectory.is_file(), trajectory
    profile = (
        root.parents[1] / "config" / root.name / "advanced.json"
        if root.parent.name == "campaign"
        else None
    )
    advanced = (
        json.loads(profile.read_text())
        if profile is not None and profile.exists()
        else None
    )
    native.prep_inputs(
        pdb_filename=str(trajectory),
        chain="A,B",
        fix_pos=metadata["fixed_positions"],
        rm_aa=advanced["omit_AAs"] if advanced else "C",
    )
    assert set(native._inputs) == INPUT_FIELDS
    for key in INPUT_FIELDS:
        assert inputs[key].shape == native._inputs[key].shape
        assert inputs[key].dtype == native._inputs[key].dtype
        assert np.array_equal(inputs[key], native._inputs[key]), key
    assert metadata["input_residue_axis"] == {
        key: np.asarray(value).tolist() for key, value in native.pdb["idx"].items()
    }
    assert metadata["native_chain_lengths"] == list(native._lengths)
    batch, length = metadata["batch"], sum(native._lengths)
    assert native._lengths[0] == len(target_sequence)
    assert (
        "".join(rc.restypes[int(i)] for i in inputs["S"][: len(target_sequence)])
        == target_sequence
    )
    assert np.all(np.isin(np.arange(len(target_sequence)), inputs["fix_pos"]))
    shapes = {
        "S": (batch, length, 21),
        "logits": (batch, length, 21),
        "decoding_order": (batch, length, 1),
        "seq": (batch,),
        "score": (batch,),
        "seqid": (batch,),
    }
    for key, shape in shapes.items():
        assert outputs[key].shape == shape, (key, outputs[key].shape, shape)
    for key in OUTPUT_FIELDS - {"seq"}:
        assert outputs[key].dtype == np.dtype(
            "float64"
            if key in {"score", "seqid"}
            else "int32" if key == "decoding_order" else "float32"
        ), (key, "native output dtype")
    assert outputs["seq"].dtype.kind == "U"
    assert np.isfinite(outputs["logits"]).all()
    assert np.all((outputs["S"] == 0) | (outputs["S"] == 1)) and np.all(
        outputs["S"].sum(-1) == 1
    )
    assert np.all(
        np.sort(outputs["decoding_order"][..., 0], axis=-1) == np.arange(length)
    )
    rescored = native._get_score(inputs, outputs)
    errors = {}
    for key in ["score", "seqid"]:
        assert np.isfinite(outputs[key]).all()
        errors[key] = float(np.max(np.abs(outputs[key] - rescored[key])))
        assert errors[key] <= 1e-4
    tokens = outputs["S"].argmax(-1)
    fixed = inputs["fix_pos"]
    assert np.all(tokens[:, fixed] == inputs["S"][fixed])
    assert np.array_equal(native._get_seq(outputs)["seq"], outputs["seq"])
    # Batch size and effective native preparation settings come from the saved command input.
    profile = (
        root.parents[1] / "config" / root.name / "advanced.json"
        if root.parent.name == "campaign"
        else None
    )
    if profile is not None and profile.exists():
        advanced = json.loads(profile.read_text())
        assert batch == advanced["num_seqs"]
        assert (
            metadata["weights"] == advanced["mpnn_weights"]
            and metadata["checkpoint"] == advanced["model_path"]
        )
        assert metadata["sampling_temperature"] == advanced["sampling_temp"]
        assert metadata["backbone_noise"] == advanced["backbone_noise"]
    matched_rows = 0
    csv_mapping = []
    for table in root.glob("*.csv"):
        for row in csv.DictReader(table.open(newline="")):
            if not row.get("Design", "").startswith(
                trajectory.stem + "_mpnn"
            ) or not row.get("Sequence"):
                continue
            selected = [
                i
                for i, seq in enumerate(outputs["seq"])
                if str(seq).split("/")[-1] == row["Sequence"]
            ]
            assert selected, "CSV sequence absent from complete native batch"
            # B45's supplemental rejection table predates complete MPNN capture
            # and records zero placeholders in these columns. Preserve that table;
            # verify real native campaign CSV scores and every raw sampled score.
            csv_score_matches = row.get("MPNN_score") in (
                None,
                "",
                "nan",
                "None",
            ) or any(
                abs(float(row["MPNN_score"]) - outputs["score"][i]) <= 0.00501
                for i in selected
            )
            csv_seqid_matches = row.get("MPNN_seq_recovery") in (
                None,
                "",
                "nan",
                "None",
            ) or any(
                abs(float(row["MPNN_seq_recovery"]) - outputs["seqid"][i]) <= 0.00501
                for i in selected
            )
            if table.name != "rejected_mpnn_full_stats.csv":
                assert (
                    csv_score_matches and csv_seqid_matches
                ), "Native campaign CSV score differs from sampled native score"
            csv_mapping.append(
                {
                    "table": table.name,
                    "design": row["Design"],
                    "native_batch_indices": selected,
                    "native_csv_score": row.get("MPNN_score"),
                    "native_csv_seqid": row.get("MPNN_seq_recovery"),
                    "csv_score_matches_native": bool(csv_score_matches),
                    "csv_seqid_matches_native": bool(csv_seqid_matches),
                }
            )
            matched_rows += 1
    mpnn_reports.append(
        {
            "archive": str(archive.relative_to(root)),
            "batch": batch,
            "all_samples_before_filtering_retained": True,
            "csv_rows_matched_to_native_batch": matched_rows,
            "fixed_positions_verified": len(fixed),
            "complete_fields": sorted(values),
            "native_score_max_errors": errors,
            "csv_mapping": csv_mapping,
            "csv_score_status": "native campaign CSV checked; supplemental rejected-full table zero placeholders preserved; raw prefilter scores authoritative",
        }
    )

if a.diagnostic:
    result = json.loads((root / "diagnostic.json").read_text())
    assert (
        result["original_campaign_decision"] == "rejected"
        and result["campaign_acceptance_changed"] is False
    )
    assert len(reports) == 2 * len(result["models"])
    for row in result["models"]:
        index = row["model_index"] + 1
        for name in ["complex", "binder"]:
            report = next(
                r for r in reports if r["archive"].startswith(f"model{index}/{name}/")
            )
            for seq in report["sequences"]:
                assert seq.get("B", seq.get("A")) == result["sequence"]
            reference = (
                root
                / f"model{index}"
                / (
                    "reference.npz"
                    if name == "complex"
                    else "binder-reference/reference.npz"
                )
            )
            with np.load(reference, allow_pickle=False) as ref, np.load(
                root / report["archive"], allow_pickle=False
            ) as actual:
                assert (
                    set(actual.files) == set(ref.files) == NATIVE_FIELDS
                ), "Incomplete reference/export fields"
                for k in NATIVE_FIELDS:
                    assert actual[k].shape == ref[k].shape, (k, "shape")
                    assert actual[k].dtype == ref[k].dtype, (k, "dtype")
                    assert np.allclose(
                        actual[k],
                        ref[k],
                        atol=(
                            0.000501
                            if k == "atom_positions"
                            else 0.0000501 if k == "plddt" else 1e-5
                        ),
                        rtol=0,
                        equal_nan=True,
                    ), k
            aligned = (
                root
                / f"model{index}"
                / "binder"
                / f"{result['design']}_model{index}.pdb"
            )
            assert (
                "".join(
                    gemmi.find_tabulated_residue(r.name).one_letter_code
                    for c in gemmi.read_structure(str(aligned))[0]
                    for r in c
                )
                == result["sequence"]
            )
        relaxed = (
            root
            / f"model{index}"
            / "complex-relaxed"
            / f"{result['design']}_model{index}.pdb"
        )
        assert (
            "".join(
                gemmi.find_tabulated_residue(r.name).one_letter_code
                for r in gemmi.read_structure(str(relaxed))[0]["B"]
            )
            == result["sequence"]
        )
print(
    json.dumps(
        {
            "directory": str(root),
            "native_exports": reports,
            "diagnostic": a.diagnostic,
            "complete_mpnn_batches": mpnn_reports,
            "scientific_binding_claim": False,
        },
        indent=2,
    )
)
