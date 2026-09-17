import pathlib
import sys
data = pathlib.Path(sys.argv[1]).read_bytes()
pathlib.Path(sys.argv[2]).write_text('static const unsigned char bootstrap[] = {' + ','.join(map(str,data)) + ',0};\n')
