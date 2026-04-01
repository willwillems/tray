/**
 * Core unit tests: SI prefix parsing.
 */

import { assertEquals, assertAlmostEquals } from "jsr:@std/assert";
import { parseParameterValue, parseParametricFilter } from "../src/parameters.ts";

Deno.test("parseParameterValue - plain number", () => {
  const r = parseParameterValue("100");
  assertEquals(r.numeric, 100);
  assertEquals(r.unit, null);
});

Deno.test("parseParameterValue - k prefix", () => {
  const r = parseParameterValue("10k", "ohm");
  assertEquals(r.numeric, 10000);
  assertEquals(r.unit, "ohm");
});

Deno.test("parseParameterValue - M prefix", () => {
  const r = parseParameterValue("4.7M");
  assertEquals(r.numeric, 4700000);
});

Deno.test("parseParameterValue - u prefix (micro)", () => {
  const r = parseParameterValue("4.7uF");
  assertEquals(r.numeric, 0.0000047);
  assertEquals(r.unit, "farad");
});

Deno.test("parseParameterValue - n prefix (nano)", () => {
  const r = parseParameterValue("100nF");
  assertAlmostEquals(r.numeric!, 1e-7, 1e-18);
  assertEquals(r.unit, "farad");
});

Deno.test("parseParameterValue - p prefix (pico)", () => {
  const r = parseParameterValue("22pF");
  assertAlmostEquals(r.numeric!, 22e-12, 1e-23);
  assertEquals(r.unit, "farad");
});

Deno.test("parseParameterValue - V unit", () => {
  const r = parseParameterValue("50V");
  assertEquals(r.numeric, 50);
  assertEquals(r.unit, "volt");
});

Deno.test("parseParameterValue - non-numeric returns null numeric", () => {
  const r = parseParameterValue("DIP-8");
  assertEquals(r.numeric, null);
  assertEquals(r.unit, null);
});

Deno.test("parseParameterValue - empty string returns null", () => {
  const r = parseParameterValue("");
  assertEquals(r.numeric, null);
  assertEquals(r.unit, null);
});

Deno.test("parseParameterValue - m prefix (milli)", () => {
  const r = parseParameterValue("100mA");
  assertEquals(r.numeric, 0.1);
  assertEquals(r.unit, "ampere");
});

Deno.test("parseParameterValue - G prefix (giga)", () => {
  const r = parseParameterValue("2.4GHz");
  assertEquals(r.numeric, 2.4e9);
  assertEquals(r.unit, "hertz");
});

Deno.test("parseParametricFilter - parses >= expression", () => {
  const r = parseParametricFilter("resistance>=10k");
  assertEquals(r?.key, "resistance");
  assertEquals(r?.operator, ">=");
  assertEquals(r?.value, "10k");
  assertEquals(r?.numeric, 10000);
});

Deno.test("parseParametricFilter - parses = expression", () => {
  const r = parseParametricFilter("package=0805");
  assertEquals(r?.key, "package");
  assertEquals(r?.operator, "=");
  assertEquals(r?.value, "0805");
});

Deno.test("parseParametricFilter - returns null for invalid", () => {
  const r = parseParametricFilter("not a filter");
  assertEquals(r, null);
});
