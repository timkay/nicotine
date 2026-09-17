CC ?= cc
CXX ?= c++
Q = vendor/quickjs
CFLAGS = -Os -g -Wall -Wextra -Wno-unused-parameter -ffunction-sections -fdata-sections
CPPFLAGS = -I$(Q) -D_GNU_SOURCE -DCONFIG_VERSION='"2026-06-04"'
QOBJ = $(addprefix build/,quickjs.o dtoa.o libregexp.o libunicode.o cutils.o)

.PHONY: all test clean qt gtk native-qt gui-test
all: build/nicotine
build:
	mkdir -p build
build/bootstrap.h: js/bootstrap.js tools/embed.py | build
	python3 tools/embed.py $< $@
build/%.o: $(Q)/%.c | build
	$(CC) $(CPPFLAGS) $(CFLAGS) -Wno-sign-compare -Wno-cast-function-type -c $< -o $@
build/runtime.o: src/runtime.c src/platform.h build/bootstrap.h
	$(CC) $(CPPFLAGS) $(CFLAGS) $$(pkg-config --cflags libffi libcurl) -Ibuild -c $< -o $@
build/platform.o: src/platform_posix.c src/platform.h | build
	$(CC) $(CPPFLAGS) $(CFLAGS) $$(pkg-config --cflags libcurl) -c $< -o $@
build/nicotine: build/runtime.o build/platform.o $(QOBJ)
	$(CC) -Wl,--gc-sections $^ -o $@ -lffi -lcurl -ldl -lm -lpthread
	strip $@
qt:
	python3 tools/build_gui.py qt-analog $(if $(SYSROOT),--sysroot $(SYSROOT))
gtk:
	python3 tools/build_gui.py gtk $(if $(SYSROOT),--sysroot $(SYSROOT))
native-qt:
	python3 tools/build_gui.py qt $(if $(SYSROOT),--sysroot $(SYSROOT))
gui-test:
	python3 tests/test_gui.py
test: all
	python3 tests/test_runtime.py
clean:
	rm -f build/*.o build/bootstrap.h build/nicotine build/libnicotine-qt.so
