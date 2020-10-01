// Copyright (c) 2020, NVIDIA CORPORATION.
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

#include "column.hpp"
#include "cudf/types.hpp"
#include "js_native_api.h"
#include "macros.hpp"
#include "napi.h"
#include <nv_node/utilities/args.hpp>
#include <nv_node/utilities/cpp_to_napi.hpp>
#include <nv_node/utilities/napi_to_cpp.hpp>
#include <map>
#include <iostream>
#include <string>

static std::map<std::string, cudf::type_id> const map_test = {
  {"empty", cudf::type_id::EMPTY},
  {"int8", cudf::type_id::INT8},
  {"int16", cudf::type_id::INT16},
  {"int32", cudf::type_id::INT32},
  {"int64", cudf::type_id::INT64},
  {"uint8", cudf::type_id::UINT8},
  {"uint16", cudf::type_id::UINT16},
  {"uint32", cudf::type_id::UINT32},
  {"uint64", cudf::type_id::UINT64},
  {"float32", cudf::type_id::FLOAT32},
  {"float64", cudf::type_id::FLOAT64},
  {"bool8", cudf::type_id::BOOL8},
  {"timestamp_days", cudf::type_id::TIMESTAMP_DAYS},
  {"timestamp_seconds", cudf::type_id::TIMESTAMP_SECONDS},
  {"timestamp_milliseconds", cudf::type_id::TIMESTAMP_MILLISECONDS},
  {"timestamp_microseconds", cudf::type_id::TIMESTAMP_MICROSECONDS},
  {"timestamp_nanoseconds", cudf::type_id::TIMESTAMP_NANOSECONDS},
  {"duration_days", cudf::type_id::DURATION_DAYS },
  {"duration_seconds", cudf::type_id::DURATION_SECONDS},
  {"duration_milliseconds", cudf::type_id::DURATION_MILLISECONDS},
  {"duration_microseconds", cudf::type_id::DURATION_MICROSECONDS},
  {"duration_nanoseconds", cudf::type_id::DURATION_NANOSECONDS },
  {"dictionary32", cudf::type_id::DICTIONARY32},
  {"string", cudf::type_id::STRING          },
  {"list", cudf::type_id::LIST                },
  {"decimal32", cudf::type_id::DECIMAL32},
  {"decimal64", cudf::type_id::DECIMAL64},
};

namespace nv {


Napi::FunctionReference Column::constructor;

Napi::Object Column::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function ctor = DefineClass(
        env,
        "Column",
        {
          InstanceMethod("type", &Column::GetDataType),
          InstanceMethod("size", &Column::GetSize),
          InstanceMethod("set_null_count", &Column::SetNullCount),
          InstanceMethod("null_count", &Column::GetNullCount),
          InstanceMethod("has_nulls", &Column::HasNulls),
          InstanceMethod("release", &Column::Release),
        }
    );

    Column::constructor = Napi::Persistent(ctor);
    Column::constructor.SuppressDestruct();
    exports.Set("Column", ctor);

    return exports;
}

Napi::Value Column::New(
  cudf::data_type dtype, cudf::size_type size, rmm::device_buffer&& data,
  rmm::device_buffer&& null_mask, cudf::size_type null_count
) {

  auto buf = Column::constructor.New({});
  Column::Unwrap(buf)->column_.reset(new cudf::column{dtype, size, data});

  return buf;
}

Column::Column(Napi::CallbackInfo const& info) : Napi::ObjectWrap<Column>(info) {
  CallbackArgs args{info};

  cudf::data_type dtype = cudf::data_type(cudf::type_id::EMPTY);
  auto it = map_test.find(info[0].As<Napi::String>());
  
  if (it != map_test.end()) {
    cudf::data_type dtype = cudf::data_type(it->second);
    this->dtype_ = info[0].As<Napi::String>();
  }else{
    //temporary error handling
    throw Napi::Error::New(info.Env(), "invalid dtype");
  }

  Span<char> data = args[2];
  cudf::size_type size = data.size();

  this->column_.reset(
    new cudf::column{dtype, size, data}
  );
  
}

Napi::Value Column::GetDataType(Napi::CallbackInfo const& info) {
  return Napi::String::New(info.Env(), dtype_);
}

Napi::Value Column::GetSize(Napi::CallbackInfo const& info) {
  return CPPToNapi(info)(Col()->size());
}

Napi::Value Column::HasNulls(Napi::CallbackInfo const& info) {
  return CPPToNapi(info)(Col()->has_nulls());
}

Napi::Value Column::GetNullCount(Napi::CallbackInfo const& info) {
  return CPPToNapi(info)(Col()->null_count());
}

Napi::Value Column::Release(Napi::CallbackInfo const& info){
  Col()->release();
  return info.Env().Undefined();
}

Napi::Value Column::SetNullCount(Napi::CallbackInfo const& info){
 CallbackArgs args{info};
//  if(args.Length() == 1 && info[0].IsNumber()){
   Col()->set_null_count(info[0].As<Napi::Number>());
//  }
 return info.Env().Undefined();
}

}