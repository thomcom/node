// Copyright (c) 2021-2022, NVIDIA CORPORATION.
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

#include "las.hpp"

#include <rmm/device_uvector.hpp>
#include <rmm/exec_policy.hpp>

#include <cudf/column/column_factories.hpp>
#include <cudf/io/datasource.hpp>

#include <thrust/iterator/counting_iterator.h>
#include <thrust/iterator/transform_iterator.h>
#include <thrust/iterator/zip_iterator.h>
#include <thrust/tuple.h>

#include <iostream>

namespace nv {

namespace {

const int HEADER_BYTE_SIZE = 227;

#define LAS_UINT16(data, offset) \
  (uint16_t)(static_cast<uint32_t>(data[offset]) | (static_cast<uint32_t>(data[offset + 1]) << 8))

#define LAS_INT32(data, offset)                                                                    \
  (int32_t)(static_cast<uint32_t>(data[offset]) | (static_cast<uint32_t>(data[offset + 1]) << 8) | \
            (static_cast<uint32_t>(data[offset + 2]) << 16) |                                      \
            (static_cast<uint32_t>(data[offset + 3]) << 24))

#define LAS_UINT32(data, offset)                               \
  (uint32_t)(static_cast<uint32_t>(data[offset]) |             \
             (static_cast<uint32_t>(data[offset + 1]) << 8) |  \
             (static_cast<uint32_t>(data[offset + 2]) << 16) | \
             (static_cast<uint32_t>(data[offset + 3]) << 24))

#define LAS_DOUBLE(data, offset)                                                                  \
  (double)(static_cast<uint64_t>(data[offset]) | (static_cast<uint64_t>(data[offset + 1]) << 8) | \
           (static_cast<uint64_t>(data[offset + 2]) << 16) |                                      \
           (static_cast<uint64_t>(data[offset + 3]) << 24) |                                      \
           (static_cast<uint64_t>(data[offset + 4]) << 32) |                                      \
           (static_cast<uint64_t>(data[offset + 5]) << 40) |                                      \
           (static_cast<uint64_t>(data[offset + 6]) << 48) |                                      \
           (static_cast<uint64_t>(data[offset + 7]) << 56))

__global__ void parse_header(uint8_t const* las_header_data, LasHeader* result) {
  size_t byte_offset = 0;

  // File signature (4 bytes)
  for (int i = 0; i < 4; ++i) { result->file_signature[i] = *(las_header_data + i); }
  byte_offset += 4;

  // File source id (2 bytes)
  result->file_source_id = LAS_UINT16(las_header_data, byte_offset);
  byte_offset += 2;

  // Global encoding (2 bytes)
  result->global_encoding = LAS_UINT16(las_header_data, byte_offset);
  byte_offset += 2;

  // Project ID (16 bytes)
  // not required
  byte_offset += 16;

  // Version major (1 byte)
  result->version_major = *(las_header_data + byte_offset);
  byte_offset += 1;

  // Version minor (1 byte)
  result->version_minor = *(las_header_data + byte_offset);
  byte_offset += 1;

  // System identifier (32 bytes)
  for (int i = 0; i < 32; ++i) {
    result->system_identifier[i] = *(las_header_data + byte_offset + i);
  }
  byte_offset += 32;

  // Generating software (32 bytes)
  for (int i = 0; i < 32; ++i) {
    result->generating_software[i] = *(las_header_data + byte_offset + i);
  }
  byte_offset += 32;

  // File creation day of year (2 bytes)
  // not required
  byte_offset += 2;

  // File creation year (2 bytes)
  // not required
  byte_offset += 2;

  // Header size (2 bytes)
  result->header_size = LAS_UINT16(las_header_data, byte_offset);
  byte_offset += 2;

  // Offset to point data (4 bytes)
  result->point_data_offset = LAS_UINT32(las_header_data, byte_offset);
  byte_offset += 4;

  // Number of variable length records (4 bytes)
  result->variable_length_records_count = LAS_UINT32(las_header_data, byte_offset);
  byte_offset += 4;

  // Point data format id (1 byte)
  result->point_data_format_id = *(las_header_data + byte_offset);
  if (result->point_data_format_id & 128 || result->point_data_format_id & 64) {
    result->point_data_format_id &= 127;
  }
  byte_offset += 1;

  // Point data record length (2 bytes)
  result->point_data_size = LAS_UINT16(las_header_data, byte_offset);
  byte_offset += 2;

  // Number of point records (4 bytes)
  result->point_record_count = LAS_UINT32(las_header_data, byte_offset);
  byte_offset += 4;

  // Number of points by return (20 bytes)
  for (int i = 0; i < 4; ++i) {
    result->points_by_return_count[i] = LAS_UINT32(las_header_data, byte_offset);
    byte_offset += 4;
  }

  // X scale factor (8 bytes)
  result->x_scale = LAS_DOUBLE(las_header_data, byte_offset);
  byte_offset += 8;

  // Y scale factor (8 bytes)
  result->y_scale = LAS_DOUBLE(las_header_data, byte_offset);
  byte_offset += 8;

  // Z scale factor (8 bytes)
  result->z_scale = LAS_DOUBLE(las_header_data, byte_offset);
  byte_offset += 8;

  // X offset (8 bytes)
  result->x_offset = LAS_DOUBLE(las_header_data, byte_offset);
  byte_offset += 8;

  // Y offset (8 bytes)
  result->y_offset = LAS_DOUBLE(las_header_data, byte_offset);
  byte_offset += 8;

  // Z offset (8 bytes)
  result->z_offset = LAS_DOUBLE(las_header_data, byte_offset);
  byte_offset += 8;

  // Max X (8 bytes)
  result->max_x = LAS_DOUBLE(las_header_data, byte_offset);
  byte_offset += 8;

  // Min X (8 bytes)
  result->min_x = LAS_DOUBLE(las_header_data, byte_offset);
  byte_offset += 8;

  // Max Y (8 bytes)
  result->max_y = LAS_DOUBLE(las_header_data, byte_offset);
  byte_offset += 8;

  // Min Y (8 bytes)
  result->min_y = LAS_DOUBLE(las_header_data, byte_offset);
  byte_offset += 8;

  // Max Z (8 bytes)
  result->max_z = LAS_DOUBLE(las_header_data, byte_offset);
  byte_offset += 8;

  // Min Z (8 bytes)
  result->min_z = LAS_DOUBLE(las_header_data, byte_offset);
  byte_offset += 8;
}

std::unique_ptr<cudf::io::datasource::buffer> read(
  const std::unique_ptr<cudf::io::datasource>& datasource,
  size_t offset,
  size_t size,
  rmm::cuda_stream_view stream) {
  if (datasource->supports_device_read()) { return datasource->device_read(offset, size, stream); }
  auto device_buffer = rmm::device_buffer(size, stream);
  CUDA_TRY(cudaMemcpyAsync(device_buffer.data(),
                           datasource->host_read(offset, size)->data(),
                           size,
                           cudaMemcpyHostToDevice,
                           stream.value()));
  return cudf::io::datasource::buffer::create(std::move(device_buffer));
}

std::unique_ptr<cudf::table> get_point_cloud_records(
  const std::unique_ptr<cudf::io::datasource>& datasource,
  LasHeader const& header,
  rmm::mr::device_memory_resource* mr,
  rmm::cuda_stream_view stream) {
  auto const& point_record_count = header.point_record_count;
  auto const& point_data_offset  = header.point_data_offset;
  auto const& point_data_size    = header.point_data_size;

  auto point_data =
    read(datasource, point_data_offset, point_data_size * point_record_count, stream);

  auto data = point_data->data();
  auto idxs = thrust::make_counting_iterator(0);
  std::vector<std::unique_ptr<cudf::column>> cols;

  switch (header.point_data_format_id) {
    // POINT
    // FORMAT
    // ZERO
    case 0: {
      cols.resize(PointDataFormatZeroColumnNames.size());

      std::vector<cudf::type_id> ids{{
        cudf::type_id::INT32,  // x
        cudf::type_id::INT32,  // y
        cudf::type_id::INT32,  // z
        cudf::type_id::INT16,  // intensity
        cudf::type_id::INT8,   // bit_data
        cudf::type_id::INT8,   // classification
        cudf::type_id::INT8,   // scan angle
        cudf::type_id::INT8,   // user data
        cudf::type_id::INT16,  // point source id
      }};

      std::transform(ids.begin(), ids.end(), cols.begin(), [&](auto const& type_id) {
        return cudf::make_numeric_column(
          cudf::data_type{type_id}, point_record_count, cudf::mask_state::UNALLOCATED, stream, mr);
      });

      auto iter = thrust::make_transform_iterator(idxs, [=] __host__ __device__(int const& i) {
        auto ptr = data + (i * (point_data_size));
        PointDataFormatZero point_data;
        point_data.x               = LAS_INT32(ptr, 0);
        point_data.y               = LAS_INT32(ptr, 4);
        point_data.z               = LAS_INT32(ptr, 8);
        point_data.intensity       = LAS_UINT16(ptr, 12);
        point_data.bit_data        = ptr[14];
        point_data.classification  = ptr[15];
        point_data.scan_angle      = ptr[16];
        point_data.user_data       = ptr[17];
        point_data.point_source_id = LAS_UINT16(ptr, 18);
        return thrust::make_tuple(point_data.x,
                                  point_data.y,
                                  point_data.z,
                                  point_data.intensity,
                                  point_data.bit_data,
                                  point_data.classification,
                                  point_data.scan_angle,
                                  point_data.user_data,
                                  point_data.point_source_id);
      });

      thrust::copy(
        rmm::exec_policy(stream),
        iter,
        iter + point_record_count,
        thrust::make_zip_iterator(cols[0]->mutable_view().begin<int32_t>(),    // x
                                  cols[1]->mutable_view().begin<int32_t>(),    // y
                                  cols[2]->mutable_view().begin<int32_t>(),    // z
                                  cols[3]->mutable_view().begin<int16_t>(),    // intensity
                                  cols[4]->mutable_view().begin<int8_t>(),     // bits
                                  cols[5]->mutable_view().begin<int8_t>(),     // classification
                                  cols[6]->mutable_view().begin<int8_t>(),     // scan angle
                                  cols[7]->mutable_view().begin<int8_t>(),     // user data
                                  cols[8]->mutable_view().begin<int16_t>()));  // point source id
      break;
    }

    // POINT
    // FORMAT
    // ONE
    case 1: {
      cols.resize(PointDataFormatOneColumnNames.size());

      std::vector<cudf::type_id> ids{{
        cudf::type_id::INT32,    // x
        cudf::type_id::INT32,    // y
        cudf::type_id::INT32,    // z
        cudf::type_id::INT16,    // intensity
        cudf::type_id::INT8,     // bit_data
        cudf::type_id::INT8,     // classification
        cudf::type_id::INT8,     // scan angle
        cudf::type_id::INT8,     // user data
        cudf::type_id::INT16,    // point source id
        cudf::type_id::FLOAT64,  // gps time
      }};

      std::transform(ids.begin(), ids.end(), cols.begin(), [&](auto const& type_id) {
        return cudf::make_numeric_column(
          cudf::data_type{type_id}, point_record_count, cudf::mask_state::UNALLOCATED, stream, mr);
      });

      auto iter = thrust::make_transform_iterator(idxs, [=] __host__ __device__(int const& i) {
        auto ptr = data + (i * (point_data_size));
        PointDataFormatOne point_data;
        point_data.x               = LAS_INT32(ptr, 0);
        point_data.y               = LAS_INT32(ptr, 4);
        point_data.z               = LAS_INT32(ptr, 8);
        point_data.intensity       = LAS_UINT16(ptr, 12);
        point_data.bit_data        = ptr[14];
        point_data.classification  = ptr[15];
        point_data.scan_angle      = ptr[16];
        point_data.user_data       = ptr[17];
        point_data.point_source_id = LAS_UINT16(ptr, 18);
        point_data.gps_time        = LAS_DOUBLE(ptr, 20);
        return thrust::make_tuple(point_data.x,
                                  point_data.y,
                                  point_data.z,
                                  point_data.intensity,
                                  point_data.bit_data,
                                  point_data.classification,
                                  point_data.scan_angle,
                                  point_data.user_data,
                                  point_data.point_source_id,
                                  point_data.gps_time);
      });

      thrust::copy(
        rmm::exec_policy(stream),
        iter,
        iter + point_record_count,
        thrust::make_zip_iterator(cols[0]->mutable_view().begin<int32_t>(),     // x
                                  cols[1]->mutable_view().begin<int32_t>(),     // y
                                  cols[2]->mutable_view().begin<int32_t>(),     // z
                                  cols[3]->mutable_view().begin<int16_t>(),     // intensity
                                  cols[4]->mutable_view().begin<int8_t>(),      // bits
                                  cols[5]->mutable_view().begin<int8_t>(),      // classification
                                  cols[6]->mutable_view().begin<int8_t>(),      // scan angle
                                  cols[7]->mutable_view().begin<int8_t>(),      // user data
                                  cols[8]->mutable_view().begin<int16_t>(),     // point source id
                                  cols[9]->mutable_view().begin<double_t>()));  // gps time
      break;
    }

    // POINT
    // FORMAT
    // THREE
    // TODO: Missing colours
    case 2: {
      cols.resize(PointDataFormatTwoColumnNames.size());

      std::vector<cudf::type_id> ids{{
        cudf::type_id::INT32,  // x
        cudf::type_id::INT32,  // y
        cudf::type_id::INT32,  // z
        cudf::type_id::INT16,  // intensity
        cudf::type_id::INT8,   // bit_data
        cudf::type_id::INT8,   // classification
        cudf::type_id::INT8,   // scan angle
        cudf::type_id::INT8,   // user data
        cudf::type_id::INT16,  // point source id
      }};

      std::transform(ids.begin(), ids.end(), cols.begin(), [&](auto const& type_id) {
        return cudf::make_numeric_column(
          cudf::data_type{type_id}, point_record_count, cudf::mask_state::UNALLOCATED, stream, mr);
      });

      auto iter = thrust::make_transform_iterator(idxs, [=] __host__ __device__(int const& i) {
        auto ptr = data + (i * (point_data_size));
        PointDataFormatTwo point_data;
        point_data.x               = LAS_INT32(ptr, 0);
        point_data.y               = LAS_INT32(ptr, 4);
        point_data.z               = LAS_INT32(ptr, 8);
        point_data.intensity       = LAS_UINT16(ptr, 12);
        point_data.bit_data        = ptr[14];
        point_data.classification  = ptr[15];
        point_data.scan_angle      = ptr[16];
        point_data.user_data       = ptr[17];
        point_data.point_source_id = LAS_UINT16(ptr, 18);
        return thrust::make_tuple(point_data.x,
                                  point_data.y,
                                  point_data.z,
                                  point_data.intensity,
                                  point_data.bit_data,
                                  point_data.classification,
                                  point_data.scan_angle,
                                  point_data.user_data,
                                  point_data.point_source_id);
      });

      thrust::copy(
        rmm::exec_policy(stream),
        iter,
        iter + point_record_count,
        thrust::make_zip_iterator(cols[0]->mutable_view().begin<int32_t>(),    // x
                                  cols[1]->mutable_view().begin<int32_t>(),    // y
                                  cols[2]->mutable_view().begin<int32_t>(),    // z
                                  cols[3]->mutable_view().begin<int16_t>(),    // intensity
                                  cols[4]->mutable_view().begin<int8_t>(),     // bits
                                  cols[5]->mutable_view().begin<int8_t>(),     // classification
                                  cols[6]->mutable_view().begin<int8_t>(),     // scan angle
                                  cols[7]->mutable_view().begin<int8_t>(),     // user data
                                  cols[8]->mutable_view().begin<int16_t>()));  // point source id
      break;
    }

    // POINT
    // FORMAT
    // THREE
    // TODO: Missing colours
    case 3: {
      cols.resize(PointDataFormatThreeColumnNames.size());

      std::vector<cudf::type_id> ids{{
        cudf::type_id::INT32,    // x
        cudf::type_id::INT32,    // y
        cudf::type_id::INT32,    // z
        cudf::type_id::INT16,    // intensity
        cudf::type_id::INT8,     // bit_data
        cudf::type_id::INT8,     // classification
        cudf::type_id::INT8,     // scan angle
        cudf::type_id::INT8,     // user data
        cudf::type_id::INT16,    // point source id
        cudf::type_id::FLOAT64,  // gps time
      }};

      std::transform(ids.begin(), ids.end(), cols.begin(), [&](auto const& type_id) {
        return cudf::make_numeric_column(
          cudf::data_type{type_id}, point_record_count, cudf::mask_state::UNALLOCATED, stream, mr);
      });

      auto iter = thrust::make_transform_iterator(idxs, [=] __host__ __device__(int const& i) {
        auto ptr = data + (i * (point_data_size));
        PointDataFormatThree point_data;
        point_data.x               = LAS_INT32(ptr, 0);
        point_data.y               = LAS_INT32(ptr, 4);
        point_data.z               = LAS_INT32(ptr, 8);
        point_data.intensity       = LAS_UINT16(ptr, 12);
        point_data.bit_data        = ptr[14];
        point_data.classification  = ptr[15];
        point_data.scan_angle      = ptr[16];
        point_data.user_data       = ptr[17];
        point_data.point_source_id = LAS_UINT16(ptr, 18);
        point_data.gps_time        = LAS_DOUBLE(ptr, 20);
        return thrust::make_tuple(point_data.x,
                                  point_data.y,
                                  point_data.z,
                                  point_data.intensity,
                                  point_data.bit_data,
                                  point_data.classification,
                                  point_data.scan_angle,
                                  point_data.user_data,
                                  point_data.point_source_id,
                                  point_data.gps_time);
      });

      thrust::copy(
        rmm::exec_policy(stream),
        iter,
        iter + point_record_count,
        thrust::make_zip_iterator(cols[0]->mutable_view().begin<int32_t>(),     // x
                                  cols[1]->mutable_view().begin<int32_t>(),     // y
                                  cols[2]->mutable_view().begin<int32_t>(),     // z
                                  cols[3]->mutable_view().begin<int16_t>(),     // intensity
                                  cols[4]->mutable_view().begin<int8_t>(),      // bits
                                  cols[5]->mutable_view().begin<int8_t>(),      // classification
                                  cols[6]->mutable_view().begin<int8_t>(),      // scan angle
                                  cols[7]->mutable_view().begin<int8_t>(),      // user data
                                  cols[8]->mutable_view().begin<int16_t>(),     // point source id
                                  cols[9]->mutable_view().begin<double_t>()));  // gps time
      break;
    }
  }

  return std::make_unique<cudf::table>(std::move(cols));
}

#undef LAS_UINT16
#undef LAS_UINT32
#undef LAS_DOUBLE

}  // namespace

std::tuple<std::vector<std::string>, std::unique_ptr<cudf::table>> read_las(
  const std::unique_ptr<cudf::io::datasource>& datasource,
  rmm::mr::device_memory_resource* mr,
  rmm::cuda_stream_view stream) {
  auto header = [&]() {
    LasHeader* d_header;
    LasHeader* h_header;
    cudaMalloc(&d_header, sizeof(LasHeader));
    auto data = read(datasource, 0, HEADER_BYTE_SIZE, stream);
    parse_header<<<1, 1>>>(data->data(), d_header);
    h_header = static_cast<LasHeader*>(malloc(sizeof(LasHeader)));
    cudaMemcpy(h_header, d_header, sizeof(LasHeader), cudaMemcpyDefault);
    return *h_header;
  }();

  auto table = get_point_cloud_records(datasource, header, mr, stream);

  std::vector<std::string> names;
  switch (header.point_data_format_id) {
    case 0: {
      names = PointDataFormatZeroColumnNames;
      break;
    }
    case 1: {
      names = PointDataFormatOneColumnNames;
      break;
    }
    case 2: {
      names = PointDataFormatTwoColumnNames;
      break;
    }
    case 3: {
      names = PointDataFormatThreeColumnNames;
      break;
    }
  }

  return std::make_tuple(names, std::move(table));
}

}  // namespace nv
