#!/usr/bin/env python3
import argparse
import pathlib


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', type=pathlib.Path, required=True)
    parser.add_argument('--output', type=pathlib.Path, required=True)
    args = parser.parse_args()
    source = args.input.read_text()
    delimiter = 'ardia_page'
    if f'){delimiter}"' in source:
        parser.error('page script contains the C++ literal delimiter')
    text = ('#ifndef ARDIA_LINUX_PAGE_SCRIPT_H_\n'
            '#define ARDIA_LINUX_PAGE_SCRIPT_H_\n'
            'namespace ardia {\n'
            f'inline constexpr char kArdiaLinuxPageScript[] = R"{delimiter}({source}){delimiter}";\n'
            '}\n'
            '#endif\n')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    if not args.output.exists() or args.output.read_text() != text:
        args.output.write_text(text)


if __name__ == '__main__':
    main()
