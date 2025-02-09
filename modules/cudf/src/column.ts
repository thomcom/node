// Copyright (c) 2020-2022, NVIDIA CORPORATION.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import {MemoryData} from '@rapidsai/cuda';
import {DeviceBuffer, MemoryResource} from '@rapidsai/rmm';

import * as CUDF from './addon';
import {Scalar} from './scalar';
import {Table} from './table';
import {
  Bool8,
  DataType,
  Float32,
  Float64,
  IndexType,
  Int32,
  Int64,
  Integral,
  Numeric,
  Utf8String,
} from './types/dtypes';
import {CommonType, Interpolation} from './types/mappings';

export type PadSideType = 'left'|'right'|'both'

export type ColumnProps<T extends DataType = any> = {
  /*
   * ColumnProps *with* a `nullMask` shouldn't allow `data` to be an Array with elements and
   * nulls:
   * ```javascript
   * new Column({
   *   type: new Int32,
   *   data: [1, 0, 2, 3, 0], ///< must not include nulls
   *   nullMask: [true, false, true, true, false]
   * })
   *  ```
   */
  type: T;
  data?: DeviceBuffer | MemoryData | T['scalarType'][] | null;
  offset?: number;
  length?: number;
  nullCount?: number;
  nullMask?: DeviceBuffer | MemoryData | any[] | boolean | null;
  children?: ReadonlyArray<Column>| null;
}|{
  /*
   * ColumnProps *without* a `nullMask` should allow `data` to be an Array with elements and
   * nulls:
   * ```javascript
   * new Column({
   *   type: new Int32,
   *   data: [1, null, 2, 3, null] ///< can include nulls
   * })
   *  ```
   */
  type: T;
  data?: DeviceBuffer|MemoryData|(T['scalarType'] | null | undefined)[]|null;
  offset?: number;
  length?: number;
  nullCount?: number;
  nullMask?: never;
  children?: ReadonlyArray<Column>|null;
};

export interface ColumnConstructor {
  readonly prototype: Column;
  new<T extends DataType = any>(props: ColumnProps<T>): Column<T>;

  /**
   * Row-wise concatenates the given list of strings columns and returns a single strings column
   * result.
   *
   * @param columns List of string columns to concatenate.
   * @param separator String that should inserted between each string from each row.
   * @param nullRepr String that should be used in place of any null strings found in any column.
   *   Null value means any null entry in any column will produces a null result for that row.
   * @param separate_nulls If true, then the separator is included for null rows if nullRepr is
   *   valid.
   * @param memoryResource The optional MemoryResource used to allocate the result column's device
   *   memory
   * @returns New column with concatenated results.
   */
  concatenate(columns: Table,
              separator: string,
              nullRepr: string|null,
              separate_nulls: boolean,
              memoryResource?: MemoryResource): Column<Utf8String>;

  /**
   * Fills a column with a sequence of values specified by an initial value and a step of 1.
   *
   * @param size Size of the output column
   * @param init First value in the sequence
   * @param memoryResource The optional MemoryResource used to allocate the result column's device
   *   memory
   * @returns column with the sequence
   */
  sequence<U extends DataType>(size: number, init: Scalar<U>, memoryResource?: MemoryResource):
    Column<U>;

  /**
   * Fills a column with a sequence of values specified by an initial value and a step.
   *
   * @param size Size of the output column
   * @param init First value in the sequence
   * @param step Increment value
   * @param memoryResource The optional MemoryResource used to allocate the result column's device
   *   memory
   * @returns column with the sequence
   */
  sequence<U extends DataType>(size: number,
                               init: Scalar<U>,
                               step: Scalar<U>,
                               memoryResource?: MemoryResource): Column<U>;

  /**
   * Fills a column with the Utf-8 string located at filepath. If a delimiter is included then
   * the input string will be split into a sequence of strings. The delimiter will remain
   * at the end of each string in the column, except for the last. If no delimiter is included,
   * the input string will be read into a single string at element 0 of the Colum.
   *
   * @param filepath The location of the input file.
   * @param delimiter Optional delimiter.
   * @returns column containing one or more strings.
   *
   * @note The maximum size of a string read with this method is 2^30
   */
  readText(filepath: string, delimiter: string): Column<Utf8String>;
}

/**
 * A low-level wrapper for libcudf Column Objects
 */
export interface Column<T extends DataType = any> {
  readonly type: T;
  readonly data: DeviceBuffer;
  readonly mask: DeviceBuffer;
  readonly disposed: boolean;

  readonly offset: number;
  readonly length: number;
  readonly nullable: boolean;
  readonly hasNulls: boolean;
  readonly nullCount: number;
  readonly numChildren: number;

  /**
   * @summary Explicitly free the device memory associated with this Column and all child Columns.
   */
  dispose(): void;

  /**
   * @summary Return sub-selection from a Column.
   *
   * @description Gathers the rows of the source columns according to `selection`, such that row "i"
   * in the resulting Column's columns will contain row `selection[i]` from the source columns. The
   * number of rows in the result column will be equal to the number of elements in selection. A
   * negative value i in the selection is interpreted as i+n, where `n` is the number of rows in
   * the source column.
   *
   * For dictionary columns, the keys column component is copied and not trimmed if the gather
   * results in abandoned key elements.
   *
   * @param selection A Series of 8/16/32-bit signed or unsigned integer indices to gather.
   * @param nullify_out_of_bounds If `true`, coerce rows that corresponds to out-of-bounds indices
   *   in the selection to null. If `false`, skips all bounds checking for selection values. Pass
   *   false if you are certain that the selection contains only valid indices for better
   *   performance. If `false` and there are out-of-bounds indices in the selection, the behavior
   *   is undefined. Defaults to `false`.
   * @param memoryResource An optional MemoryResource used to allocate the result's device memory.
   */
  gather(selection: Column<IndexType>,
         nullify_out_of_bounds: boolean,
         memoryResource?: MemoryResource): Column<T>;

  /**
   * Return sub-selection from a Column
   *
   * @param selection A Series of bools.
   * @param memoryResource An optional MemoryResource used to allocate the result's device memory.
   */
  applyBooleanMask(selection: Column<Bool8>, memoryResource?: MemoryResource): Column<T>;

  /**
   * Return a copy of a Column
   *
   */
  copy(memoryResource?: MemoryResource): Column<T>;

  /**
   * Return a child at the specified index to host memory
   *
   * @param index
   */
  getChild<R extends DataType>(index: number): Column<R>;

  /**
   * Return a value at the specified index to host memory
   *
   * @param index
   */
  getValue(index: number): T['scalarType']|null;

  // setValue(index: number, value?: T['scalarType'] | null): void;

  /**
   * Set the null count for the null mask
   *
   * @param nullCount
   */
  setNullCount(nullCount: number): void;

  /**
   *
   * @param mask The null-mask. Valid values are marked as 1; otherwise 0. The
   * mask bit given the data index idx is computed as:
   * ```
   * (mask[idx // 8] >> (idx % 8)) & 1
   * ```
   * @param nullCount The number of null values. If None, it is calculated
   * automatically.
   */
  setNullMask(mask: MemoryData|ArrayLike<number>|ArrayLike<bigint>, nullCount?: number): void;

  /**
   * Fills a range of elements in a column out-of-place with a scalar value.
   *
   * @param begin The starting index of the fill range (inclusive).
   * @param end The index of the last element in the fill range (exclusive).
   * @param value The scalar value to fill.
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   */
  fill(value: Scalar<T>, begin?: number, end?: number, memoryResource?: MemoryResource): Column<T>;

  /**
   * Fills a range of elements in-place in a column with a scalar value.
   *
   * @param begin The starting index of the fill range (inclusive)
   * @param end The index of the last element in the fill range (exclusive)
   * @param value The scalar value to fill
   */
  fillInPlace(value: Scalar<T>, begin?: number, end?: number): Column<T>;

  /**
   * Replace null values with a `Column`, `Scalar`, or the first/last non-null value.
   *
   * @param value The value to use in place of nulls.
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   */
  replaceNulls(value: Column<T>, memoryResource?: MemoryResource): Column<T>;
  replaceNulls(value: Scalar<T>, memoryResource?: MemoryResource): Column<T>;
  replaceNulls(value: boolean, memoryResource?: MemoryResource): Column<T>;

  /**
   * Concat a Column to the end of the caller, returning a new Column.
   *
   * @param other The Column to concat to the end of the caller.
   */
  concat(other: Column<T>, memoryResource?: MemoryResource): Column<T>;

  /**
   * Replace NaN values with a scalar value, or the corresponding elements from another Column.
   *
   * @param value The value to use in place of NaNs.
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   */
  replaceNaNs(value: Column<T>, memoryResource?: MemoryResource): Column<T>;
  replaceNaNs(value: Scalar<T>, memoryResource?: MemoryResource): Column<T>;

  /**
   * Add this Column and another Column or scalar value.
   *
   * @param rhs The other Column or scalar to add to this Column.
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns A Column of a common numeric type with the results of the binary operation.
   */
  add(rhs: bigint, memoryResource?: MemoryResource): Column<Int64>;
  add(rhs: number, memoryResource?: MemoryResource): Column<Float64>;
  add<R extends Numeric>(rhs: Scalar<R>, memoryResource?: MemoryResource): Column<CommonType<T, R>>;
  add<R extends Numeric>(rhs: Column<R>, memoryResource?: MemoryResource): Column<CommonType<T, R>>;

  /**
   * Subtract this Column and another Column or scalar value.
   *
   * @param rhs The other Column or scalar to subtract from this Column.
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns A Column of a common numeric type with the results of the binary operation.
   */
  sub(rhs: bigint, memoryResource?: MemoryResource): Column<Int64>;
  sub(rhs: number, memoryResource?: MemoryResource): Column<Float64>;
  sub<R extends Numeric>(rhs: Scalar<R>, memoryResource?: MemoryResource): Column<CommonType<T, R>>;
  sub<R extends Numeric>(rhs: Column<R>, memoryResource?: MemoryResource): Column<CommonType<T, R>>;

  /**
   * Multiply this Column and another Column or scalar value.
   *
   * @param rhs The other Column or scalar to multiply this column by.
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns A Column of a common numeric type with the results of the binary operation.
   */
  mul(rhs: bigint, memoryResource?: MemoryResource): Column<Int64>;
  mul(rhs: number, memoryResource?: MemoryResource): Column<Float64>;
  mul<R extends Numeric>(rhs: Scalar<R>, memoryResource?: MemoryResource): Column<CommonType<T, R>>;
  mul<R extends Numeric>(rhs: Column<R>, memoryResource?: MemoryResource): Column<CommonType<T, R>>;

  /**
   * Divide this Column and another Column or scalar value.
   *
   * @param rhs The other Column or scalar to divide this Column by.
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns A Column of a common numeric type with the results of the binary operation.
   */
  div(rhs: bigint, memoryResource?: MemoryResource): Column<Int64>;
  div(rhs: number, memoryResource?: MemoryResource): Column<Float64>;
  div<R extends Numeric>(rhs: Scalar<R>, memoryResource?: MemoryResource): Column<CommonType<T, R>>;
  div<R extends Numeric>(rhs: Column<R>, memoryResource?: MemoryResource): Column<CommonType<T, R>>;

  /**
   * True-divide this Column and another Column or scalar value.
   *
   * @param rhs The other Column or scalar to true-divide this Column by.
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns A Column of a common numeric type with the results of the binary operation.
   */
  trueDiv(rhs: bigint, memoryResource?: MemoryResource): Column<Int64>;
  trueDiv(rhs: number, memoryResource?: MemoryResource): Column<Float64>;
  trueDiv<R extends Numeric>(rhs: Scalar<R>,
                             memoryResource?: MemoryResource): Column<CommonType<T, R>>;
  trueDiv<R extends Numeric>(rhs: Column<R>,
                             memoryResource?: MemoryResource): Column<CommonType<T, R>>;

  /**
   * Floor-divide this Column and another Column or scalar value.
   *
   * @param rhs The other Column or scalar to floor-divide this Column by.
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns A Column of a common numeric type with the results of the binary operation.
   */
  floorDiv(rhs: bigint, memoryResource?: MemoryResource): Column<Int64>;
  floorDiv(rhs: number, memoryResource?: MemoryResource): Column<Float64>;
  floorDiv<R extends Numeric>(rhs: Scalar<R>,
                              memoryResource?: MemoryResource): Column<CommonType<T, R>>;
  floorDiv<R extends Numeric>(rhs: Column<R>,
                              memoryResource?: MemoryResource): Column<CommonType<T, R>>;

  /**
   * Modulo this Column and another Column or scalar value.
   *
   * @param rhs The other Column or scalar to mod with this Column.
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns A Column of a common numeric type with the results of the binary operation.
   */
  mod(rhs: bigint, memoryResource?: MemoryResource): Column<Int64>;
  mod(rhs: number, memoryResource?: MemoryResource): Column<Float64>;
  mod<R extends Numeric>(rhs: Scalar<R>, memoryResource?: MemoryResource): Column<CommonType<T, R>>;
  mod<R extends Numeric>(rhs: Column<R>, memoryResource?: MemoryResource): Column<CommonType<T, R>>;

  /**
   * Power this Column and another Column or scalar value.
   *
   * @param rhs The other Column or scalar to use as the exponent for the power operation.
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns A Column of a common numeric type with the results of the binary operation.
   */
  pow(rhs: bigint, memoryResource?: MemoryResource): Column<Int64>;
  pow(rhs: number, memoryResource?: MemoryResource): Column<Float64>;
  pow<R extends Numeric>(rhs: Scalar<R>, memoryResource?: MemoryResource): Column<CommonType<T, R>>;
  pow<R extends Numeric>(rhs: Column<R>, memoryResource?: MemoryResource): Column<CommonType<T, R>>;

  /**
   * Perform the binary '==' operation between this column and another Column or scalar value.
   *
   * @rhs The other Column or scalar to compare with this column.
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns A Column of booleans with the comparison result.
   */
  eq(rhs: bigint, memoryResource?: MemoryResource): Column<Bool8>;
  eq(rhs: number, memoryResource?: MemoryResource): Column<Bool8>;
  eq<R extends Numeric>(rhs: Scalar<R>, memoryResource?: MemoryResource): Column<Bool8>;
  eq<R extends Numeric>(rhs: Column<R>, memoryResource?: MemoryResource): Column<Bool8>;

  /**
   * Perform the binary '!=' operation between this column and another Column or scalar value.
   *
   * @rhs The other Column or scalar to compare with this column.
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns A Column of booleans with the comparison result.
   */
  ne(rhs: bigint, memoryResource?: MemoryResource): Column<Bool8>;
  ne(rhs: number, memoryResource?: MemoryResource): Column<Bool8>;
  ne<R extends Numeric>(rhs: Scalar<R>, memoryResource?: MemoryResource): Column<Bool8>;
  ne<R extends Numeric>(rhs: Column<R>, memoryResource?: MemoryResource): Column<Bool8>;

  /**
   * Perform the binary '<' operation between this column and another Column or scalar value.
   *
   * @rhs The other Column or scalar to compare with this column.
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns A Column of booleans with the comparison result.
   */
  lt(rhs: bigint, memoryResource?: MemoryResource): Column<Bool8>;
  lt(rhs: number, memoryResource?: MemoryResource): Column<Bool8>;
  lt<R extends Numeric>(rhs: Scalar<R>, memoryResource?: MemoryResource): Column<Bool8>;
  lt<R extends Numeric>(rhs: Column<R>, memoryResource?: MemoryResource): Column<Bool8>;

  /**
   * Perform the binary '<=' operation between this column and another Column or scalar value.
   *
   * @rhs The other Column or scalar to compare with this column.
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns A Column of booleans with the comparison result.
   */
  le(rhs: bigint, memoryResource?: MemoryResource): Column<Bool8>;
  le(rhs: number, memoryResource?: MemoryResource): Column<Bool8>;
  le<R extends Numeric>(rhs: Scalar<R>, memoryResource?: MemoryResource): Column<Bool8>;
  le<R extends Numeric>(rhs: Column<R>, memoryResource?: MemoryResource): Column<Bool8>;

  /**
   * Perform the binary '>' operation between this column and another Column or scalar value.
   *
   * @rhs The other Column or scalar to compare with this column.
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns A Column of booleans with the comparison result.
   */
  gt(rhs: bigint, memoryResource?: MemoryResource): Column<Bool8>;
  gt(rhs: number, memoryResource?: MemoryResource): Column<Bool8>;
  gt<R extends Numeric>(rhs: Scalar<R>, memoryResource?: MemoryResource): Column<Bool8>;
  gt<R extends Numeric>(rhs: Column<R>, memoryResource?: MemoryResource): Column<Bool8>;

  /**
   * Perform the binary '>=' operation between this column and another Column or scalar value.
   *
   * @rhs The other Column or scalar to compare with this column.
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns A Column of booleans with the comparison result.
   */
  ge(rhs: bigint, memoryResource?: MemoryResource): Column<Bool8>;
  ge(rhs: number, memoryResource?: MemoryResource): Column<Bool8>;
  ge<R extends Numeric>(rhs: Scalar<R>, memoryResource?: MemoryResource): Column<Bool8>;
  ge<R extends Numeric>(rhs: Column<R>, memoryResource?: MemoryResource): Column<Bool8>;

  /**
   * Perform a binary `&` operation between this Column and another Column or scalar value.
   *
   * @param rhs The other Column or scalar to use.
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns A Column of a common numeric type with the results of the binary operation.
   */
  bitwiseAnd(rhs: bigint, memoryResource?: MemoryResource): Column<T>;
  bitwiseAnd(rhs: number, memoryResource?: MemoryResource): Column<T>;
  bitwiseAnd<R extends Numeric>(rhs: Scalar<R>,
                                memoryResource?: MemoryResource): Column<CommonType<T, R>>;
  bitwiseAnd<R extends Numeric>(rhs: Column<R>,
                                memoryResource?: MemoryResource): Column<CommonType<T, R>>;

  /**
   * Perform a binary `|` operation between this Column and another Column or scalar value.
   *
   * @param rhs The other Column or scalar to use.
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns A Column of a common numeric type with the results of the binary operation.
   */
  bitwiseOr(rhs: bigint, memoryResource?: MemoryResource): Column<T>;
  bitwiseOr(rhs: number, memoryResource?: MemoryResource): Column<T>;
  bitwiseOr<R extends Numeric>(rhs: Scalar<R>,
                               memoryResource?: MemoryResource): Column<CommonType<T, R>>;
  bitwiseOr<R extends Numeric>(rhs: Column<R>,
                               memoryResource?: MemoryResource): Column<CommonType<T, R>>;

  /**
   * Perform a binary `^` operation between this Column and another Column or scalar value.
   *
   * @param rhs The other Column or scalar to use.
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns A Column of a common numeric type with the results of the binary operation.
   */
  bitwiseXor(rhs: bigint, memoryResource?: MemoryResource): Column<T>;
  bitwiseXor(rhs: number, memoryResource?: MemoryResource): Column<T>;
  bitwiseXor<R extends Numeric>(rhs: Scalar<R>,
                                memoryResource?: MemoryResource): Column<CommonType<T, R>>;
  bitwiseXor<R extends Numeric>(rhs: Column<R>,
                                memoryResource?: MemoryResource): Column<CommonType<T, R>>;

  /**
   * Perform a binary `&&` operation between this Column and another Column or scalar value.
   *
   * @param rhs The other Column or scalar to use.
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns A Column of a common numeric type with the results of the binary operation.
   */
  logicalAnd(rhs: bigint, memoryResource?: MemoryResource): Column<Int64>;
  logicalAnd(rhs: number, memoryResource?: MemoryResource): Column<Float64>;
  logicalAnd<R extends Numeric>(rhs: Scalar<R>,
                                memoryResource?: MemoryResource): Column<CommonType<T, R>>;
  logicalAnd<R extends Numeric>(rhs: Column<R>,
                                memoryResource?: MemoryResource): Column<CommonType<T, R>>;

  /**
   * Perform a binary `||` operation between this Column and another Column or scalar value.
   *
   * @param rhs The other Column or scalar to use.
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns A Column of a common numeric type with the results of the binary operation.
   */
  logicalOr(rhs: bigint, memoryResource?: MemoryResource): Column<Int64>;
  logicalOr(rhs: number, memoryResource?: MemoryResource): Column<Float64>;
  logicalOr<R extends Numeric>(rhs: Scalar<R>,
                               memoryResource?: MemoryResource): Column<CommonType<T, R>>;
  logicalOr<R extends Numeric>(rhs: Column<R>,
                               memoryResource?: MemoryResource): Column<CommonType<T, R>>;

  /**
   * Perform a binary `<<` operation between this Column and another Column or scalar value.
   *
   * @param rhs The other Column or scalar to use.
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns A Column of a common numeric type with the results of the binary operation.
   */
  shiftLeft(rhs: bigint, memoryResource?: MemoryResource): Column<T>;
  shiftLeft(rhs: number, memoryResource?: MemoryResource): Column<T>;
  shiftLeft<R extends Numeric>(rhs: Scalar<R>,
                               memoryResource?: MemoryResource): Column<CommonType<T, R>>;
  shiftLeft<R extends Numeric>(rhs: Column<R>,
                               memoryResource?: MemoryResource): Column<CommonType<T, R>>;

  /**
   * Perform a binary `>>` operation between this Column and another Column or scalar
   * value.
   *
   * @param rhs The other Column or scalar to use.
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns A Column of a common numeric type with the results of the binary operation.
   */
  shiftRight(rhs: bigint, memoryResource?: MemoryResource): Column<T>;
  shiftRight(rhs: number, memoryResource?: MemoryResource): Column<T>;
  shiftRight<R extends Numeric>(rhs: Scalar<R>,
                                memoryResource?: MemoryResource): Column<CommonType<T, R>>;
  shiftRight<R extends Numeric>(rhs: Column<R>,
                                memoryResource?: MemoryResource): Column<CommonType<T, R>>;

  /**
   * Perform a binary `shiftRightUnsigned` operation between this Column and another Column or
   * scalar value.
   *
   * @param rhs The other Column or scalar to use.
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns A Column of a common numeric type with the results of the binary operation.
   */
  shiftRightUnsigned(rhs: bigint, memoryResource?: MemoryResource): Column<T>;
  shiftRightUnsigned(rhs: number, memoryResource?: MemoryResource): Column<T>;
  shiftRightUnsigned<R extends Numeric>(rhs: Scalar<R>,
                                        memoryResource?: MemoryResource): Column<CommonType<T, R>>;
  shiftRightUnsigned<R extends Numeric>(rhs: Column<R>,
                                        memoryResource?: MemoryResource): Column<CommonType<T, R>>;

  /**
   * Perform a binary `logBase` operation between this Column and another Column or scalar value.
   *
   * @param rhs The other Column or scalar to use.
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns A Column of a common numeric type with the results of the binary operation.
   */
  logBase(rhs: bigint, memoryResource?: MemoryResource): Column<Int64>;
  logBase(rhs: number, memoryResource?: MemoryResource): Column<Float64>;
  logBase<R extends Numeric>(rhs: Scalar<R>,
                             memoryResource?: MemoryResource): Column<CommonType<T, R>>;
  logBase<R extends Numeric>(rhs: Column<R>,
                             memoryResource?: MemoryResource): Column<CommonType<T, R>>;

  /**
   * Perform a binary `atan2` operation between this Column and another Column or scalar value.
   *
   * @param rhs The other Column or scalar to use.
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns A Column of a common numeric type with the results of the binary operation.
   */
  atan2(rhs: bigint, memoryResource?: MemoryResource): Column<Int64>;
  atan2(rhs: number, memoryResource?: MemoryResource): Column<Float64>;
  atan2<R extends Numeric>(rhs: Scalar<R>,
                           memoryResource?: MemoryResource): Column<CommonType<T, R>>;
  atan2<R extends Numeric>(rhs: Column<R>,
                           memoryResource?: MemoryResource): Column<CommonType<T, R>>;

  /**
   * Perform a binary `nullEquals` operation between this Column and another Column or scalar
   * value.
   *
   * @param rhs The other Column or scalar to use.
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns A Column of a common numeric type with the results of the binary operation.
   */
  nullEquals(rhs: bigint, memoryResource?: MemoryResource): Column<Bool8>;
  nullEquals(rhs: number, memoryResource?: MemoryResource): Column<Bool8>;
  nullEquals<R extends Numeric>(rhs: Scalar<R>, memoryResource?: MemoryResource): Column<Bool8>;
  nullEquals<R extends Numeric>(rhs: Column<R>, memoryResource?: MemoryResource): Column<Bool8>;

  /**
   * Perform a binary `nullMax` operation between this Column and another Column or scalar value.
   *
   * @param rhs The other Column or scalar to use.
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns A Column of a common numeric type with the results of the binary operation.
   */
  nullMax(rhs: bigint, memoryResource?: MemoryResource): Column<Int64>;
  nullMax(rhs: number, memoryResource?: MemoryResource): Column<Float64>;
  nullMax<R extends Numeric>(rhs: Scalar<R>,
                             memoryResource?: MemoryResource): Column<CommonType<T, R>>;
  nullMax<R extends Numeric>(rhs: Column<R>,
                             memoryResource?: MemoryResource): Column<CommonType<T, R>>;

  /**
   * Perform a binary `nullMin` operation between this Column and another Column or scalar value.
   *
   * @param rhs The other Column or scalar to use.
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns A Column of a common numeric type with the results of the binary operation.
   */
  nullMin(rhs: bigint, memoryResource?: MemoryResource): Column<Int64>;
  nullMin(rhs: number, memoryResource?: MemoryResource): Column<Float64>;
  nullMin<R extends Numeric>(rhs: Scalar<R>,
                             memoryResource?: MemoryResource): Column<CommonType<T, R>>;
  nullMin<R extends Numeric>(rhs: Column<R>,
                             memoryResource?: MemoryResource): Column<CommonType<T, R>>;

  /**
   * Casts data from dtype specified in input to dtype specified in output.
   *
   * @note Supports only fixed-width types.
   *
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns Column of same size as `input` containing result of the cast operation.
   */
  cast<R extends DataType>(dataType: R, memoryResource?: MemoryResource): Column<R>;

  /**
   * Creates a column of `BOOL8` elements where `true` indicates the value is null and `false`
   * indicates the row matches the given pattern
   *
   * @param pattern Regex pattern to match to each string.
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns A non-nullable column of `BOOL8` elements with `true` representing `null`
   *   values.
   */
  containsRe(pattern: string, memoryResource?: MemoryResource): Column<Bool8>;

  /**
   * Creates a column of `INT32` elements where `true` indicates the number of times the given
   * regex pattern matches in each string.
   *
   * @param pattern Regex pattern to match to each string.
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns A non-nullable column of `INT32` counts
   */
  countRe(pattern: string, memoryResource?: MemoryResource): Column<Int32>;

  /**
   * Creates a column of `BOOL8` elements where `true` indicates the value is null and `false`
   * indicates the row matches the given pattern only at the beginning of the string
   *
   * @param pattern Regex pattern to match to each string.
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns A non-nullable column of `BOOL8` elements with `true` representing `null`
   *   values.
   */
  matchesRe(pattern: string, memoryResource?: MemoryResource): Column<Bool8>;

  /**
   * Creates a column of `BOOL8` elements where `true` indicates the value is null and `false`
   * indicates the value is valid.
   *
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns A non-nullable column of `BOOL8` elements with `true` representing `null`
   *   values.
   */
  isNull(memoryResource?: MemoryResource): Column<Bool8>;

  /**
   * Creates a column of `BOOL8` elements where `true` indicates the value is valid and `false`
   * indicates the value is null.
   *
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns A non-nullable column of `BOOL8` elements with `false` representing `null`
   *   values.
   */
  isValid(memoryResource?: MemoryResource): Column<Bool8>;

  /**
   * Creates a column of `BOOL8` elements indicating the presence of `NaN` values in a
   * column of floating point values. The output element at row `i` is `true` if the element in
   * `input` at row i is `NAN`, else `false`
   *
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns A non-nullable column of `BOOL8` elements with `true` representing `NAN`
   *   values
   */
  isNaN(memoryResource?: MemoryResource): Column<Bool8>;

  /**
   * Creates a column of `BOOL8` elements indicating the absence of `NaN` values in a
   * column of floating point values. The output element at row `i` is `false` if the element in
   * `input` at row i is `NAN`, else `true`
   *
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns A non-nullable column of `BOOL8` elements with `true` representing non-`NAN`
   *   values
   */
  isNotNaN(memoryResource?: MemoryResource): Column<Bool8>;

  /**
   * Returns a new strings column converting the boolean values from the provided column into
   * strings.
   *
   * Any null entries will result in corresponding null entries in the output column.
   *
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   *
   *  @returns A string Column with booleans as strings.
   */
  stringsFromBooleans(memoryResource?: MemoryResource): Column<Utf8String>;

  /**
   * Returns a new Bool8 column parsing true/false values from the provided strings column.
   *
   * Any null entries will result in corresponding null entries in the output column.
   *
   * @param memoryResource  The optional MemoryResource used to allocate the result Column's device
   *   memory.
   *
   *  @returns A Column of boolean type with the results of the conversion.
   */
  stringsToBooleans(memoryResource?: MemoryResource): Column<Bool8>;

  /**
   * Creates a column of `BOOL8` elements indicating strings in which all characters are valid for
   * conversion to floats.
   *
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns A non-nullable column of `BOOL8` elements with `true` representing convertible
   *   values
   */
  stringIsFloat(memoryResource?: MemoryResource): Column<Bool8>;

  /**
   * Returns a new strings column converting the float values from the provided column into strings.
   *
   * Any null entries will result in corresponding null entries in the output column.
   *
   * For each float, a string is created in base-10 decimal. Negative numbers will include a '-'
   * prefix. Numbers producing more than 10 significant digits will produce a string that includes
   * scientific notation (e.g. "-1.78e+15").
   *
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   *
   *  @returns A string Column with floats as strings.
   */
  stringsFromFloats(memoryResource?: MemoryResource): Column<Utf8String>;

  /**
   * Returns a new floating point numeric column parsing float values from the provided
   * strings column.
   *
   * Any null entries will result in corresponding null entries in the output column.
   *
   * Only characters [0-9] plus a prefix '-' and '+' and decimal '.' are recognized. Additionally,
   * scientific notation is also supported (e.g. "-1.78e+5").
   *
   * @param dataType Type of floating numeric column to return.
   * @param memoryResource  The optional MemoryResource used to allocate the result Column's device
   *   memory.
   *
   *  @returns A Column of a the specified float type with the results of the conversion.
   */
  stringsToFloats<R extends Float32|Float64>(dataType: R,
                                             memoryResource?: MemoryResource): Column<R>;

  /**
   * Creates a column of `BOOL8` elements indicating strings in which all characters are valid for
   * conversion to floats.
   *
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns A non-nullable column of `BOOL8` elements with `true` representing convertible
   *   values
   */
  stringIsInteger(memoryResource?: MemoryResource): Column<Bool8>;

  /**
   * Returns a new strings column converting the integer values from the provided column into
   * strings.
   *
   * Any null entries will result in corresponding null entries in the output column.
   *
   * For each integer, a string is created in base-10 decimal. Negative numbers will include a '-'
   * prefix.
   *
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   *
   *  @returns A string Column with integers as strings.
   */
  stringsFromIntegers(memoryResource?: MemoryResource): Column<Utf8String>;

  /**
   * Returns a new integer numeric column parsing integer values from the provided strings column.
   *
   * Any null entries will result in corresponding null entries in the output column.
   *
   * Only characters [0-9] plus a prefix '-' and '+' are recognized. When any other character is
   * encountered, the parsing ends for that string and the current digits are converted into an
   * integer.
   *
   * Overflow of the resulting integer type is not checked. Each string is converted using an int64
   * type and then cast to the target integer type before storing it into the output column. If the
   * resulting integer type is too small to hold the value, the stored value will be undefined.
   *
   * @param dataType Type of integer numeric column to return.
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   *
   *  @returns A Column of a the specified integral type with the results of the conversion.
   */
  stringsToIntegers<R extends DataType>(dataType: R, memoryResource?: MemoryResource): Column<R>;

  /**
   * Returns a boolean column identifying strings in which all characters are valid for conversion
   * to integers from hex.
   *
   * The output row entry will be set to true if the corresponding string element has at least one
   * character in [0-9A-Za-z]. Also, the string may start with '0x'.
   *
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns A non-nullable column of `BOOL8` elements with `true` representing convertible
   *   values
   */
  stringIsHex(memoryResource?: MemoryResource): Column<Bool8>;

  /**
   * Returns a new strings column converting integer columns to hexadecimal characters.
   *
   * Any null entries will result in corresponding null entries in the output column.
   *
   * The output character set is '0'-'9' and 'A'-'F'. The output string width will be a multiple of
   * 2 depending on the size of the integer type. A single leading zero is applied to the first
   * non-zero output byte if it less than 0x10.
   *
   * Leading zeros are suppressed unless filling out a complete byte as in 1234 -> 04D2 instead of
   * 000004D2 or 4D2.
   *
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   *
   * @returns A string Column with integers as strings.
   */
  hexFromIntegers(memoryResource?: MemoryResource): Column<Utf8String>;

  /**
   * Returns a new integer numeric column parsing hexadecimal values from the provided strings
   * column.
   *
   * Any null entries will result in corresponding null entries in the output column.
   *
   * Only characters [0-9] and [A-F] are recognized. When any other character is encountered,
   * the parsing ends for that string. No interpretation is made on the sign of the integer.
   *
   * Overflow of the resulting integer type is not checked. Each string is converted using an
   * int64 type and then cast to the target integer type before storing it into the output column.
   * If the resulting integer type is too small to hold the value, the stored value will be
   * undefined.
   *
   * @param dataType Type of integer numeric column to return.
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   *
   * @returns A Column of a the specified integral type with the results of the conversion.
   */
  hexToIntegers<R extends DataType>(dataType: R, memoryResource?: MemoryResource): Column<R>;

  /**
   * Returns a boolean column identifying strings in which all characters are valid for conversion
   * to integers from IPv4 format.
   *
   * The output row entry will be set to true if the corresponding string element has the following
   * format xxx.xxx.xxx.xxx where xxx is integer digits between 0-255.
   *
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns A non-nullable column of `BOOL8` elements with `true` representing convertible
   *   values
   */
  stringIsIpv4(memoryResource?: MemoryResource): Column<Bool8>;

  /**
   * Converts integers into IPv4 addresses as strings.
   *
   * The IPv4 format is 1-3 character digits [0-9] between 3 dots (e.g. 123.45.67.890). Each section
   * can have a value between [0-255].
   *
   * Each input integer is dissected into four integers by dividing the input into 8-bit sections.
   * These sub-integers are then converted into [0-9] characters and placed between '.' characters.
   *
   * No checking is done on the input integer value. Only the lower 32-bits are used.
   *
   * Any null entries will result in corresponding null entries in the output column.
   *
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   *
   * @returns A string Column with ipv4 addresses as strings.
   */
  ipv4FromIntegers(memoryResource?: MemoryResource): Column<Utf8String>;

  /**
   * Converts IPv4 addresses into integers.
   *
   * The IPv4 format is 1-3 character digits [0-9] between 3 dots (e.g. 123.45.67.890). Each section
   * can have a value between [0-255].
   *
   * The four sets of digits are converted to integers and placed in 8-bit fields inside the
   * resulting integer.
   *
   * i0.i1.i2.i3 -> (i0 << 24) | (i1 << 16) | (i2 << 8) | (i3)
   *
   * No checking is done on the format. If a string is not in IPv4 format, the resulting integer is
   * undefined.
   *
   * The resulting 32-bit integer is placed in an int64_t to avoid setting the sign-bit in an
   * int32_t type. This could be changed if cudf supported a UINT32 type in the future.
   *
   * Any null entries will result in corresponding null entries in the output column.Returns a new
   * Int64 numeric column parsing hexadecimal values from the provided strings column.
   *
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   *
   * @returns New INT64 column converted from strings.
   */
  ipv4ToIntegers(memoryResource?: MemoryResource): Column<Int64>;

  /**
   * Compute the trigonometric sine for each value in this Column.
   *
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns A Column of the same number of elements containing the result of the operation.
   */
  sin(memoryResource?: MemoryResource): Column<T>;

  /**
   * Compute the trigonometric cosine for each value in this Column.
   *
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns A Column of the same number of elements containing the result of the operation.
   */
  cos(memoryResource?: MemoryResource): Column<T>;

  /**
   * Compute the trigonometric tangent for each value in this Column.
   *
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns A Column of the same number of elements containing the result of the operation.
   */
  tan(memoryResource?: MemoryResource): Column<T>;

  /**
   * Compute the trigonometric sine inverse for each value in this Column.
   *
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns A Column of the same number of elements containing the result of the operation.
   */
  asin(memoryResource?: MemoryResource): Column<T>;

  /**
   * Compute the trigonometric cosine inverse for each value in this Column.
   *
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns A Column of the same number of elements containing the result of the operation.
   */
  acos(memoryResource?: MemoryResource): Column<T>;

  /**
   * Compute the trigonometric tangent inverse for each value in this Column.
   *
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns A Column of the same number of elements containing the result of the operation.
   */
  atan(memoryResource?: MemoryResource): Column<T>;

  /**
   * Compute the hyperbolic sine for each value in this Column.
   *
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns A Column of the same number of elements containing the result of the operation.
   */
  sinh(memoryResource?: MemoryResource): Column<T>;

  /**
   * Compute the hyperbolic cosine for each value in this Column.
   *
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns A Column of the same number of elements containing the result of the operation.
   */
  cosh(memoryResource?: MemoryResource): Column<T>;

  /**
   * Compute the hyperbolic tangent for each value in this Column.
   *
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns A Column of the same number of elements containing the result of the operation.
   */
  tanh(memoryResource?: MemoryResource): Column<T>;

  /**
   * Compute the hyperbolic sine inverse for each value in this Column.
   *
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns A Column of the same number of elements containing the result of the operation.
   */
  asinh(memoryResource?: MemoryResource): Column<T>;

  /**
   * Compute the hyperbolic cosine inverse for each value in this Column.
   *
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns A Column of the same number of elements containing the result of the operation.
   */
  acosh(memoryResource?: MemoryResource): Column<T>;

  /**
   * Compute the hyperbolic tangent inverse for each value in this Column.
   *
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns A Column of the same number of elements containing the result of the operation.
   */
  atanh(memoryResource?: MemoryResource): Column<T>;

  /**
   * Compute the exponential (base e, euler number) for each value in this Column.
   *
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns A Column of the same number of elements containing the result of the operation.
   */
  exp(memoryResource?: MemoryResource): Column<T>;

  /**
   * Compute the natural logarithm (base e) for each value in this Column.
   *
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns A Column of the same number of elements containing the result of the operation.
   */
  log(memoryResource?: MemoryResource): Column<T>;

  /**
   * Compute the square-root (x^0.5) for each value in this Column.
   *
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns A Column of the same number of elements containing the result of the operation.
   */
  sqrt(memoryResource?: MemoryResource): Column<T>;

  /**
   * Compute the cube-root (x^(1.0/3)) for each value in this Column.
   *
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns A Column of the same number of elements containing the result of the operation.
   */
  cbrt(memoryResource?: MemoryResource): Column<T>;

  /**
   * Compute the smallest integer value not less than arg for each value in this Column.
   *
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns A Column of the same number of elements containing the result of the operation.
   */
  ceil(memoryResource?: MemoryResource): Column<T>;

  /**
   * Compute the largest integer value not greater than arg for each value in this Column.
   *
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns A Column of the same number of elements containing the result of the operation.
   */
  floor(memoryResource?: MemoryResource): Column<T>;

  /**
   * Compute the absolute value for each value in this Column.
   *
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns A Column of the same number of elements containing the result of the operation.
   */
  abs(memoryResource?: MemoryResource): Column<T>;

  /**
   * Round floating-point to integer for each value in this Column.
   *
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @throws cudf::logic_error if the Column's DataType isn't Float32 or Float64.
   * @returns A Column of the same number of elements containing the result of the operation.
   */
  rint(memoryResource?: MemoryResource): Column<T>;

  /**
   * Compute the bitwise not (~) for each value in this Column.
   *
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns A Column of the same number of elements containing the result of the operation.
   */
  bitInvert(memoryResource?: MemoryResource): Column<T>;

  /**
   * Compute the logical not (!) for each value in this Column.
   *
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns A Column of the same number of elements containing the result of the operation.
   */
  not(memoryResource?: MemoryResource): Column<Bool8>;

  /**
   * Compute the min of all values in this Column.
   *
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns The min of all the values in this Column.
   */
  min(memoryResource?: MemoryResource): T['scalarType'];

  /**
   * Compute the max of all values in this Column.
   *
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns The max of all the values in this Column.
   */
  max(memoryResource?: MemoryResource): T['scalarType'];

  /**
   * Compute a pair of [min,max] of all values in this Column.
   *
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns The pair of [min,max] of all the values in this Column.
   */
  minmax(memoryResource?: MemoryResource): [T['scalarType'], T['scalarType']];

  /**
   * Compute the sum of all values in this Column.
   *
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns The sum of all the values in this Column.
   */
  sum(memoryResource?: MemoryResource): T extends Integral? bigint: number;

  /**
   * Compute the product of all values in this Column.
   *
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns The product of all the values in this Column.
   */
  product(memoryResource?: MemoryResource): T extends Integral? bigint: number;

  /**
   * Compute the sumOfSquares of all values in this Column.
   *
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns The sumOfSquares of all the values in this Column.
   */
  sumOfSquares(memoryResource?: MemoryResource): T extends Integral? bigint: number;

  /**
   * Compute the mean of all values in this Column.
   *
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns The mean of all the values in this Column.
   */
  mean(memoryResource?: MemoryResource): number;

  /**
   * Compute the median of all values in this Column.
   *
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns The median of all the values in this Column.
   */
  median(memoryResource?: MemoryResource): T['scalarType'];

  /**
   * Compute the nunique of all values in this Column.
   *
   * @param dropna The dropna parameter if true, excludes nulls while computing nunique,
   * if false, includes the nulls while computing nunique.
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns The number of unique values in this Column.
   */
  nunique(dropna?: boolean, memoryResource?: MemoryResource): number;

  /**
   * Return whether all elements are true in column.
   *
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns true if all elements are true in column, else false.
   */
  all(memoryResource?: MemoryResource): boolean;

  /**
   * Return whether any elements are true in column.
   *
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns true if any elements are true in column, else false.
   */
  any(memoryResource?: MemoryResource): boolean;

  /**
   * Return unbiased variance of the column.
   * Normalized by N-1 by default. This can be changed using the `ddof` argument
   *
   * @param ddof Delta Degrees of Freedom. The divisor used in calculations is N - ddof,
   *  where N represents the number of elements.
   * @param memoryResource The optional MemoryResource used to allocate the result column's device
   *   memory.
   * @returns The median of all the values in this column.
   */
  var(ddof?: number, memoryResource?: MemoryResource): number;

  /**
   * Return sample standard deviation of the column.
   * Normalized by N-1 by default. This can be changed using the `ddof` argument
   *
   * @param ddof Delta Degrees of Freedom. The divisor used in calculations is N - ddof,
   *  where N represents the number of elements.
   * @param memoryResource The optional MemoryResource used to allocate the result column's device
   *   memory.
   * @returns The median of all the values in this column.
   */
  std(ddof?: number, memoryResource?: MemoryResource): number;

  /**
   * Return values at the given quantile.
   *
   * @param q the quantile(s) to compute, 0 <= q <= 1
   * @param interpolation This optional parameter specifies the interpolation method to use,
   *  when the desired quantile lies between two data points i and j.
   * @param memoryResource The optional MemoryResource used to allocate the result column's device
   *   memory.
   * @returns values at the given quantile.
   */
  quantile(q?: number, interpolation?: Interpolation, memoryResource?: MemoryResource): number;

  /**
   * Compute the cumulative max of all values in this Column.
   *
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns The cumulative max of all the values in this Column.
   */
  cumulativeMax(memoryResource?: MemoryResource): Column<T>;

  /**
   * Compute the cumulative min of all values in this Column.
   *
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns The cumulative min of all the values in this Column.
   */
  cumulativeMin(memoryResource?: MemoryResource): Column<T>;

  /**
   * Compute the cumulative product of all values in this Column.
   *
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns The cumulative product of all the values in this Column.
   */
  cumulativeProduct(memoryResource?: MemoryResource): Column<T>;

  /**
   * Compute the cumulative sum of all values in this Column.
   *
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns The cumulative sum of all the values in this Column.
   */
  cumulativeSum(memoryResource?: MemoryResource): Column<T>;

  /**
   * drop NA values from the column if column is of floating-type
   * values and contains NA values
   * @param memoryResource The optional MemoryResource used to allocate the result column's device
   *   memory.
   * @returns column without NaN and Null values
   */
  dropNulls(memoryResource?: MemoryResource): Column<T>;

  /**
   * drop NA values from the column if column is of floating-type
   * values and contains NA values
   * @param memoryResource The optional MemoryResource used to allocate the result column's device
   *   memory.
   * @returns column without NaN and Null values
   */
  dropNans(memoryResource?: MemoryResource): Column<T>;

  /**
   * Compress the data from a Bool8 Column to bits and return a Buffer
   *
   * @param memoryResource The optional MemoryResource used to allocate the result column's device
   *   memory.
   */
  boolsToMask(memoryResource?: MemoryResource): [DeviceBuffer, number];

  /**
   * convert NaN values in the column with Null values,
   * while also updating the nullMask and nullCount values
   *
   * @param memoryResource The optional MemoryResource used to allocate the result column's device
   *   memory.
   */
  nansToNulls(memoryResource?: MemoryResource): Column<T>;

  getJSONObject(jsonPath?: string, memoryResource?: MemoryResource): Column<T>;

  /**
   * Returns the number of bytes of each string in the Column.
   *
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns A column of `INT32` counts
   */
  countBytes(memoryResource?: MemoryResource): Column<Int32>;

  /**
   * Returns the number of characters of each string in the Column.
   *
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns A column of `INT32` counts
   */
  countCharacters(memoryResource?: MemoryResource): Column<Int32>;

  /**
   * Add padding to each string using a provided character.
   *
   * If the string is already width or more characters, no padding is performed. No strings are
   * truncated.
   *
   * Null string entries result in null entries in the output column.
   *
   * @param width The minimum number of characters for each string.
   * @param side Where to place the padding characters
   * @param fill_char Single UTF-8 character to use for padding.
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns New column with padded strings.
   */
  pad(width: number, side: PadSideType, fill_char: string, memoryResource?: MemoryResource):
    Column<Utf8String>;

  /**
   * Add '0' as padding to the left of each string.
   *
   * If the string is already width or more characters, no padding is performed. No strings are
   * truncated.
   *
   * This equivalent to `pad(width, 'left', '0')` but is more optimized for this special case.
   *
   * Null string entries result in null entries in the output column.
   *
   * @param width The minimum number of characters for each string.
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns New column of strings.
   */
  zfill(width: number, memoryResource?: MemoryResource): Column<Utf8String>;

  /**
   * Replaces each string in the column with the provided repl string within the [start,stop)
   * character position range.
   *
   * Null string entries will return null output string entries.
   *
   * Position values are 0-based meaning position 0 is the first character of each string.
   *
   * This function can be used to insert a string into specific position by specifying the same
   * position value for start and stop. The repl string can be appended to each string by specifying
   * -1 for both start and stop.
   *
   * @param repl Replacement string for specified positions found.
   * @param start Start position where repl will be added. Default is 0, first character position.
   * @param stop End position (exclusive) to use for replacement. Default of -1 specifies the end of
   *   each string.
   * @param memoryResource The optional MemoryResource used to allocate the result Column's device
   *   memory.
   * @returns New strings column
   */
  replaceSlice(repl: string, start: number, stop: number, memoryResource?: MemoryResource):
    Column<Utf8String>;

  /**
   * Splits a string column by delimiter. The delimiter string will remain at the end of each
   * string in the split column. This method will completely change the string boundaries of a
   * string column according to the delimiter: old boundaries will be removed and new boundaries
   * will be introduced according to the delimiter. In addition, if used without a delimiter,
   * the string column will be combined from n string values into a single value.
   *
   * @example
   * ```typescript
   * let a = Series.new(['abcdefg', 'bcdefgh']);
   * a.split('d');
   * [ 'abcd', 'efgbcd', 'efgh' ]
   * a.split('');
   * [ 'abcdefgbcdefgh' ]
   * ```
   * @param delimiter split along the delimiter.
   * @returns New strings column
   */
  split(delimiter: string): Column<Utf8String>;
}

// eslint-disable-next-line @typescript-eslint/no-redeclare
export const Column: ColumnConstructor = CUDF.Column;
