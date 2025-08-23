#define _XOPEN_SOURCE 700
#include <napi.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>
#include <string.h>

Napi::Value OpenAt(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 3) {
        Napi::TypeError::New(env, "Expected at least 3 arguments: dirfd, pathname, flags").ThrowAsJavaScriptException();
        return env.Null();
    }

    int dirfd = info[0].As<Napi::Number>().Int32Value();
    std::string pathname = info[1].As<Napi::String>().Utf8Value();
    int flags = info[2].As<Napi::Number>().Int32Value();
    int mode = 0;
    if (info.Length() > 3 && info[3].IsNumber()) {
        mode = info[3].As<Napi::Number>().Int32Value();
    }

    int fd = openat(dirfd, pathname.c_str(), flags, mode);
    if (fd == -1) {
        Napi::Error::New(env, strerror(errno)).ThrowAsJavaScriptException();
        return env.Null();
    }

    return Napi::Number::New(env, fd);
}

/**
 * Module initialization
 */
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("openat", Napi::Function::New(env, OpenAt));
    return exports;
}

NODE_API_MODULE(secure_open, Init)
