// Copyright (c) 2022, NVIDIA CORPORATION.
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

#include <node_cudf/column.hpp>
#include <node_cudf/table.hpp>
#include <node_cudf/utilities/metadata.hpp>

#include <cudf/io/text/data_chunk_source_factories.hpp>
#include <cudf/io/text/multibyte_split.hpp>

namespace nv {

namespace {

Column::wrapper_t split_string_column(Napi::CallbackInfo const& info,
                                      cudf::mutable_column_view const& col,
                                      std::string const& delimiter) {
  auto env = info.Env();
  /* TODO: This only splits a string column. How to generalize */
  // Check type
  auto span = cudf::device_span<char const>(col.child(1).data<char const>(), col.child(1).size());

  auto datasource = cudf::io::text::device_span_data_chunk_source(span);
  return Column::New(env, cudf::io::text::multibyte_split(datasource, delimiter));
}

Column::wrapper_t read_text_files(Napi::CallbackInfo const& info,
                                  std::string const& filename,
                                  std::string const& delimiter) {
  auto datasource = cudf::io::text::make_source_from_file(filename);
  auto text_data  = cudf::io::text::multibyte_split(*datasource, delimiter);
  auto env        = info.Env();
  return Column::New(env, std::move(text_data));
}

}  // namespace

Napi::Value Column::split(Napi::CallbackInfo const& info) {
  CallbackArgs args{info};

  if (args.Length() != 1) { NAPI_THROW(Napi::Error::New(info.Env(), "split expects a delimiter")); }

  auto delimiter = args[0];
  auto col       = this->mutable_view();
  try {
    return split_string_column(info, col, delimiter);
  } catch (cudf::logic_error const& err) { NAPI_THROW(Napi::Error::New(info.Env(), err.what())); }
}

Napi::Value Column::read_text(Napi::CallbackInfo const& info) {
  CallbackArgs args{info};

  if (args.Length() != 2) {
    NAPI_THROW(
      Napi::Error::New(info.Env(), "read_text expects a filename and an optional delimiter"));
  }

  std::string source    = args[0];
  std::string delimiter = args[1];

  try {
    return read_text_files(info, source, delimiter);

  } catch (cudf::logic_error const& err) { NAPI_THROW(Napi::Error::New(info.Env(), err.what())); }
}

}  // namespace nv
