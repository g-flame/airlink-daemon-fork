#include <napi.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>
#include <string.h>

Napi::Value RenameAt(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 4) {
        Napi::TypeError::New(env, "Expected 4 arguments: oldDirFd, oldPath, newDirFd, newPath").ThrowAsJavaScriptException();
        return env.Null();
    }

    int oldDirFd = info[0].As<Napi::Number>().Int32Value();
    std::string oldPath = info[1].As<Napi::String>().Utf8Value();
    int newDirFd = info[2].As<Napi::Number>().Int32Value();
    std::string newPath = info[3].As<Napi::String>().Utf8Value();

    if (renameat(oldDirFd, oldPath.c_str(), newDirFd, newPath.c_str()) != 0) {
        Napi::Error::New(env, strerror(errno)).ThrowAsJavaScriptException();
        return env.Null();
    }

    return Napi::Boolean::New(env, true);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("renameat", Napi::Function::New(env, RenameAt));
    return exports;
}

NODE_API_MODULE(rename_at, Init)
