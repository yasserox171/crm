from django.test import SimpleTestCase

from crm.phone import InvalidPhoneNumber, format_phone, normalize_phone, search_digits


class PhoneTests(SimpleTestCase):
    def test_accepts_common_input_formats(self):
        for raw in [
            "0612345678",
            "06 12 34 56 78",
            "06.12.34.56.78",
            "+212612345678",
            "+212 6 12 34 56 78",
            "00212612345678",
            "212612345678",
            "+212 (0)6 12 34 56 78",
            "612345678",
        ]:
            with self.subTest(raw=raw):
                self.assertEqual(normalize_phone(raw), "+212612345678")

    def test_landline_and_07_numbers(self):
        self.assertEqual(normalize_phone("0524 46 12 34"), "+212524461234")
        self.assertEqual(normalize_phone("07 00 11 22 33"), "+212700112233")

    def test_rejects_invalid_numbers(self):
        for raw in ["", "12345", "0112345678", "+33612345678", "06123456789"]:
            with self.subTest(raw=raw), self.assertRaises(InvalidPhoneNumber):
                normalize_phone(raw)

    def test_display_format(self):
        self.assertEqual(format_phone("+212612345678"), "+212 612 345678")
        self.assertEqual(format_phone("06 12 34 56 78"), "+212 612 345678")

    def test_search_digits(self):
        self.assertEqual(search_digits("0612"), "612")
        self.assertEqual(search_digits("+212 612"), "612")
