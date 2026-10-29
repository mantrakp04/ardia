#include <stdio.h>

#include "sqlite3.h"

static void print_json_string(const char* text) {
  putchar('"');
  for (const char* c = text; *c; ++c) {
    if (*c == '"' || *c == '\\') putchar('\\');
    if ((unsigned char)*c < 0x20) {
      printf("\\u%04x", *c);
      continue;
    }
    putchar(*c);
  }
  putchar('"');
}

int main(int argc, char** argv) {
  if (argc < 2) return 64;
  if (sqlite3_initialize() != SQLITE_OK) return 1;
  sqlite3* db = NULL;
  if (sqlite3_open_v2(argv[1], &db, SQLITE_OPEN_READWRITE, NULL) != SQLITE_OK) return 2;
  for (int i = 2; i < argc; ++i) {
    sqlite3_stmt* statement = NULL;
    int rows = 0;
    int status = sqlite3_prepare_v2(db, argv[i], -1, &statement, NULL);
    if (status == SQLITE_OK) {
      while ((status = sqlite3_step(statement)) == SQLITE_ROW) ++rows;
      if (status == SQLITE_DONE) status = SQLITE_OK;
    }
    printf("{\"ok\": %s, \"rows\": %d, \"error\": ", status == SQLITE_OK ? "true" : "false", rows);
    print_json_string(status == SQLITE_OK ? "" : sqlite3_errmsg(db));
    printf(", \"sql\": ");
    print_json_string(argv[i]);
    printf("}\n");
    sqlite3_finalize(statement);
  }
  sqlite3_close_v2(db);
  return 0;
}
