"""Inventory regressions using a real checked-in PE and small archive fixtures."""
import hashlib
from pathlib import Path
import struct
import tempfile
import unittest

from tools.inspect_installation import archive_inventory, inspect, pe_inventory

ROOT = Path(__file__).resolve().parents[1]


class InstallationInspection(unittest.TestCase):
    def test_real_pe_inventory_preserves_original(self):
        path = ROOT / "vendor/original/THEKING.EXE"
        before = path.read_bytes()
        result = pe_inventory(path)
        self.assertEqual(result["file"], "THEKING.EXE")
        self.assertEqual(result["machine"], "0x14c")
        self.assertTrue(any(row["dll"].upper() == "KERNEL32.DLL" for row in result["imports"]))
        self.assertEqual(result["sha256"], hashlib.sha256(before).hexdigest())
        self.assertEqual(path.read_bytes(), before)

    def test_archive_counts_preserve_names_and_normalize_extensions(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            header = b"\0" * 4 + b"ChessmasterDat01" + struct.pack("<II", 2, 32) + b"\0" * 4
            rows = b"".join(name.ljust(64, b"\0") + b"NONE" + struct.pack("<III", 32, 0, 0)
                            for name in (b"King.X", b"queen.x"))
            (root / "SETS.IDX").write_bytes(header + rows)
            result = archive_inventory(root, "SETS", False)
            self.assertEqual(result["entries"], 2)
            self.assertEqual(result["extensions"], {".x": 2})
            self.assertEqual(result["names"], ["King.X", "queen.x"])

    def test_truncated_archive_is_an_error(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "SETS.IDX").write_bytes(b"\0" * 4 + b"ChessmasterDat01" + struct.pack("<II", 1, 32) + b"\0" * 4)
            with self.assertRaises(ValueError):
                archive_inventory(root, "SETS", False)

    def test_missing_installation_fails_loudly(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, "Missing required"):
                inspect(Path(directory))


if __name__ == "__main__":
    unittest.main()
