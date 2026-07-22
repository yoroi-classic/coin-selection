export * from '@dcspark/cardano-multiplatform-lib-nodejs';

export class BigNum {
  readonly #value: bigint;

  private constructor(value: bigint) {
    if (value < BigInt(0)) throw new RangeError('BigNum cannot be negative');
    this.#value = value;
  }

  static from_str(value: string): BigNum {
    if (!/^\d+$/.test(value))
      throw new TypeError('BigNum requires decimal digits');
    return new BigNum(BigInt(value));
  }

  static from_bigint(value: bigint): BigNum {
    return new BigNum(value);
  }

  to_bigint(): bigint {
    return this.#value;
  }

  to_str(): string {
    return this.#value.toString();
  }

  checked_add(other: BigNum): BigNum {
    return new BigNum(this.#value + other.#value);
  }

  checked_sub(other: BigNum): BigNum {
    if (other.#value > this.#value) throw new RangeError('BigNum underflow');
    return new BigNum(this.#value - other.#value);
  }

  checked_mul(other: BigNum): BigNum {
    return new BigNum(this.#value * other.#value);
  }

  clamped_sub(other: BigNum): BigNum {
    return new BigNum(
      other.#value > this.#value ? BigInt(0) : this.#value - other.#value,
    );
  }

  compare(other: BigNum): number {
    return this.#value < other.#value ? -1 : this.#value > other.#value ? 1 : 0;
  }
}
