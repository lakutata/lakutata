#include <napi.h>

Napi::String Method(const Napi::CallbackInfo &info)
{
  Napi::Env env = info.Env();
  return Napi::String::New(env, "world");
}

Napi::Object Init(Napi::Env env, Napi::Object exports)
{
printf("this is a test\n");
  exports.Set(Napi::String::New(env, "hello"),
              Napi::Function::New(env, Method)); // 设置函数名和函数指针
  return exports;
}

NODE_API_MODULE(hello, Init)
