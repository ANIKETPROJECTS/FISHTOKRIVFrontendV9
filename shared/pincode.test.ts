import test from "node:test";
import assert from "node:assert/strict";
import { isValidIndianPincode, normalizePincode } from "./pincode";

test("normalizes whitespace and numeric pincode values consistently", () => {
  assert.equal(normalizePincode(" 400 060 "), "400060");
  assert.equal(normalizePincode(400060), "400060");
});

test("only accepts six-digit Indian pincodes", () => {
  assert.equal(isValidIndianPincode("400060"), true);
  assert.equal(isValidIndianPincode("1111"), false);
  assert.equal(isValidIndianPincode("000000"), false);
});
