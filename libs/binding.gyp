{
  "targets": [
    {
      "target_name": "secure_open",
      "sources": ["secure_open.cc"],
      "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
      "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
      "defines": ["NAPI_CPP_EXCEPTIONS"],
      "cflags_cc!": ["-fno-exceptions"],
      "cflags!": ["-fno-exceptions"],
      "cflags_cc": ["-fexceptions"],
      "cflags": ["-fexceptions"]
    },
    {
      "target_name": "rename_at",
      "sources": ["rename_at.cc"],
      "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
      "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
      "defines": ["NAPI_CPP_EXCEPTIONS"],
      "cflags_cc!": ["-fno-exceptions"],
      "cflags!": ["-fno-exceptions"],
      "cflags_cc": ["-fexceptions"],
      "cflags": ["-fexceptions"]
    }
  ]
}
